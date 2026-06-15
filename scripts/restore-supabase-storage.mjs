#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const backupDir = process.env.BACKUP_DIR || `${process.env.HOME}/backups/vortek-supabase/2026-06-15-0740`;
const storageDir = join(backupDir, 'storage');
const retries = Number(process.env.RESTORE_RETRIES || 5);
const retrySleepMs = Number(process.env.RESTORE_RETRY_SLEEP_MS || 5000);

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const storageUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1`;
const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
};
const failures = [];

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

async function ensureBucket(bucket) {
  const res = await fetch(`${storageUrl}/bucket/${encodeURIComponent(bucket)}`, { headers });
  if (res.ok) return;

  await fetchRetry(`create-bucket:${bucket}`, `${storageUrl}/bucket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
      file_size_limit: null,
      allowed_mime_types: null,
    }),
  });
}

async function uploadObject(bucket, filePath) {
  const localPath = join(storageDir, bucket, filePath);
  const data = await readFile(localPath);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');

  await fetchRetry(`upload:${bucket}/${filePath}`, `${storageUrl}/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: data,
  });
}

async function listLocalFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...await listLocalFiles(abs, rel));
    } else if (entry.name !== 'storage-manifest.json') {
      files.push(rel);
    }
  }

  return files;
}

async function main() {
  const bucketDirs = (await readdir(storageDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  console.error(`[${new Date().toISOString()}] Storage restore started: ${relative(process.cwd(), storageDir)}`);

  for (const bucket of bucketDirs) {
    await ensureBucket(bucket);
    const files = await listLocalFiles(join(storageDir, bucket));
    console.error(`[${new Date().toISOString()}] Bucket ${bucket}: ${files.length} files`);

    for (const file of files) {
      try {
        await uploadObject(bucket, file);
      } catch {
        // fetchRetry already captured the failure.
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Storage restore finished with ${failures.length} failures.`);
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.error(`[${new Date().toISOString()}] Storage restore finished`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
