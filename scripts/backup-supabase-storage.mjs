#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stamp = process.env.BACKUP_STAMP || new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const outDir = process.env.STORAGE_BACKUP_OUT_DIR
  || join(process.env.HOME || process.cwd(), 'backups', 'vortek-supabase', stamp, 'storage');
const retries = Number(process.env.BACKUP_RETRIES || 5);
const retrySleepMs = Number(process.env.BACKUP_RETRY_SLEEP_MS || 10_000);

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const storageUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1`;
const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
};
const failures = [];
const manifest = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRetry(label, url, options = {}) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers || {}),
        },
      });

      if (res.ok) return res;

      const text = await res.text().catch(() => '');
      lastError = new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    } catch (error) {
      lastError = error;
    }

    console.error(`[${new Date().toISOString()}] FAIL ${label} attempt=${attempt}/${retries}: ${lastError.message}`);
    await sleep(retrySleepMs * attempt);
  }

  failures.push(`${label}: ${lastError?.message || 'unknown error'}`);
  throw lastError;
}

async function listBuckets() {
  const res = await fetchRetry('list-buckets', `${storageUrl}/bucket`);
  return res.json();
}

async function listObjects(bucket, prefix = '') {
  const all = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const res = await fetchRetry(`list:${bucket}/${prefix}`, `${storageUrl}/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prefix,
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;

    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }

  return all;
}

async function walkBucket(bucket, prefix = '') {
  const entries = await listObjects(bucket, prefix);
  const files = [];

  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const isFolder = !entry.id && !entry.metadata;

    if (isFolder) {
      files.push(...await walkBucket(bucket, path));
    } else {
      files.push(path);
    }
  }

  return files;
}

async function downloadObject(bucket, objectPath) {
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const url = `${storageUrl}/object/${encodeURIComponent(bucket)}/${encodedPath}`;
  const target = join(outDir, bucket, objectPath);

  await mkdir(dirname(target), { recursive: true });
  const res = await fetchRetry(`download:${bucket}/${objectPath}`, url);
  await pipeline(res.body, createWriteStream(target));
  manifest.push({ bucket, path: objectPath, file: target });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  console.error(`[${new Date().toISOString()}] Storage backup started: ${outDir}`);

  const buckets = await listBuckets();
  for (const bucket of buckets) {
    const bucketName = bucket.name || bucket.id;
    if (!bucketName) continue;

    console.error(`[${new Date().toISOString()}] Bucket ${bucketName}: listing`);
    let files = [];
    try {
      files = await walkBucket(bucketName);
    } catch (error) {
      failures.push(`bucket:${bucketName}: ${error.message}`);
      continue;
    }

    console.error(`[${new Date().toISOString()}] Bucket ${bucketName}: ${files.length} files`);
    for (const file of files) {
      try {
        await downloadObject(bucketName, file);
      } catch {
        // fetchRetry already registered the detailed failure.
      }
    }
  }

  await writeFile(join(outDir, 'storage-manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), manifest, failures }, null, 2));
  console.error(`[${new Date().toISOString()}] Storage backup finished: ${outDir}`);

  if (failures.length > 0) {
    console.error(`Storage backup finished with ${failures.length} failures.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
