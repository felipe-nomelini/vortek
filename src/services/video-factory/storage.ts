import "server-only";

import { createHash } from "node:crypto";
import { resolve4 } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";

import sharp from "sharp";
import { z } from "zod";

import {
  BVF_REFERENCE_MAX_BYTES,
  BVF_REFERENCE_MAX_DIMENSION,
  BVF_REFERENCE_MAX_PIXELS,
  BVF_SIGNED_URL_TTL_SECONDS,
  type BvfReferenceListFilters,
  type BvfReferenceSlot,
  type BvfReferenceTarget,
} from "@/lib/video-factory/storage-contracts";
import { createServiceClient } from "@/lib/supabase";

export const BVF_STORAGE_BUCKET = "video-factory" as const;

const uuidSchema = z.string().uuid();
const rpcResultSchema = z
  .object({
    assetId: z.string().uuid(),
    created: z.boolean().optional(),
    changed: z.boolean().optional(),
    active: z.boolean(),
  })
  .passthrough();

const ASSET_COLUMNS = [
  "id",
  "job_id",
  "attempt_id",
  "persona_id",
  "produto_id",
  "asset_type",
  "reference_slot",
  "active",
  "storage_path",
  "mime_type",
  "width",
  "height",
  "duration_seconds",
  "fps",
  "video_codec",
  "audio_codec",
  "checksum_sha256",
  "metadata",
  "created_by",
  "deactivated_at",
  "deactivated_by",
  "deactivation_reason",
  "created_at",
].join(",");

const MIME_BY_FORMAT = {
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  png: { mimeType: "image/png", extension: "png" },
  webp: { mimeType: "image/webp", extension: "webp" },
} as const;

type ReferenceImage = {
  buffer: Buffer;
  mimeType: (typeof MIME_BY_FORMAT)[keyof typeof MIME_BY_FORMAT]["mimeType"];
  extension: (typeof MIME_BY_FORMAT)[keyof typeof MIME_BY_FORMAT]["extension"];
  width: number;
  height: number;
  checksumSha256: string;
};

type RegisterReferenceInput = {
  assetId: string;
  actorId: string;
  target: BvfReferenceTarget;
  image: ReferenceImage;
  storagePath: string;
  metadata: Record<string, string | number>;
};

export class BvfStorageError extends Error {
  constructor(readonly code: string, cause?: unknown) {
    super(code, cause ? { cause } : undefined);
  }
}

function fail(code: string, cause?: unknown): never {
  throw new BvfStorageError(code, cause);
}

function safeOriginalName(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, 255) || "reference-image";
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

export function isBvfBlockedRemoteAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  return true;
}

export function parseBvfRemoteImageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    fail("BVF_STORAGE_REMOTE_URL_INVALID", error);
  }
  if (
    url.protocol !== "https:" ||
    Boolean(url.username) ||
    Boolean(url.password) ||
    (url.port !== "" && url.port !== "443")
  ) {
    fail("BVF_STORAGE_REMOTE_URL_INVALID");
  }
  return url;
}

async function resolvePinnedPublicIpv4(hostname: string): Promise<string[]> {
  if (isIP(hostname) === 6) fail("BVF_STORAGE_REMOTE_ADDRESS_BLOCKED");
  const addresses = isIP(hostname) === 4 ? [hostname] : await resolve4(hostname).catch((error) => {
    fail("BVF_STORAGE_REMOTE_DNS_FAILED", error);
  });
  const unique = [...new Set(addresses)];
  if (unique.length === 0 || unique.some(isBlockedIpv4)) {
    fail("BVF_STORAGE_REMOTE_ADDRESS_BLOCKED");
  }
  return unique;
}

async function requestRemoteImage(url: URL, deadline: number): Promise<{ buffer: Buffer; redirect: URL | null }> {
  const addresses = await resolvePinnedPublicIpv4(url.hostname);
  const remaining = deadline - Date.now();
  if (remaining <= 0) fail("BVF_STORAGE_REMOTE_TIMEOUT");

  return new Promise((resolve, reject) => {
    let addressIndex = 0;
    const request = https.request(url, {
      method: "GET",
      agent: false,
      headers: {
        Accept: "image/jpeg,image/png,image/webp",
        "User-Agent": "Bentevi-Video-Factory/1.0",
      },
      lookup: ((_hostname: string, _options: unknown, callback: Function) => {
        const address = addresses[addressIndex % addresses.length];
        addressIndex += 1;
        callback(null, address, 4);
      }) as never,
      timeout: remaining,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        try {
          resolve({ buffer: Buffer.alloc(0), redirect: parseBvfRemoteImageUrl(new URL(response.headers.location, url).toString()) });
        } catch (error) {
          reject(error);
        }
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new BvfStorageError("BVF_STORAGE_REMOTE_HTTP_FAILED", new Error(`HTTP ${status}`)));
        return;
      }

      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > BVF_REFERENCE_MAX_BYTES) {
        response.destroy(new BvfStorageError("BVF_STORAGE_FILE_TOO_LARGE"));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > BVF_REFERENCE_MAX_BYTES) {
          response.destroy(new BvfStorageError("BVF_STORAGE_FILE_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ buffer: Buffer.concat(chunks), redirect: null }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new BvfStorageError("BVF_STORAGE_REMOTE_TIMEOUT")));
    request.on("error", reject);
    request.end();
  });
}

export async function downloadBvfRemoteImage(sourceUrl: string): Promise<Buffer> {
  let current = parseBvfRemoteImageUrl(sourceUrl);
  const deadline = Date.now() + 10_000;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const result = await requestRemoteImage(current, deadline);
    if (!result.redirect) {
      if (result.buffer.length === 0) fail("BVF_STORAGE_IMAGE_EMPTY");
      return result.buffer;
    }
    if (redirects === 3) fail("BVF_STORAGE_TOO_MANY_REDIRECTS");
    current = result.redirect;
  }
  fail("BVF_STORAGE_TOO_MANY_REDIRECTS");
}

export async function inspectBvfReferenceImage(buffer: Buffer): Promise<ReferenceImage> {
  if (buffer.length === 0) fail("BVF_STORAGE_IMAGE_EMPTY");
  if (buffer.length > BVF_REFERENCE_MAX_BYTES) fail("BVF_STORAGE_FILE_TOO_LARGE");

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: BVF_REFERENCE_MAX_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch (error) {
    fail("BVF_STORAGE_IMAGE_INVALID", error);
  }

  const format = metadata.format as keyof typeof MIME_BY_FORMAT;
  const resolved = MIME_BY_FORMAT[format];
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!resolved) fail("BVF_STORAGE_IMAGE_FORMAT_INVALID");
  if (
    width <= 0 ||
    height <= 0 ||
    width > BVF_REFERENCE_MAX_DIMENSION ||
    height > BVF_REFERENCE_MAX_DIMENSION ||
    width * height > BVF_REFERENCE_MAX_PIXELS
  ) {
    fail("BVF_STORAGE_IMAGE_DIMENSIONS_INVALID");
  }

  return {
    buffer,
    mimeType: resolved.mimeType,
    extension: resolved.extension,
    width,
    height,
    checksumSha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function buildBvfReferenceStoragePath(
  assetId: string,
  target: BvfReferenceTarget,
  extension: ReferenceImage["extension"],
): string {
  const id = uuidSchema.parse(assetId);
  if (target.kind === "persona") {
    return `personas/${target.personaId}/${target.slot}/${id}.${extension}`;
  }
  return `products/${target.productId}/${id}.${extension}`;
}

export function buildBvfJobStoragePath(input: {
  assetId: string;
  jobId: string;
  attemptId: string;
  assetType: "generated_video" | "thumbnail" | "poster_frame";
  extension: "mp4" | "jpg" | "png" | "webp";
}): string {
  return `jobs/${uuidSchema.parse(input.jobId)}/${uuidSchema.parse(input.attemptId)}/${input.assetType}/${uuidSchema.parse(input.assetId)}.${input.extension}`;
}

export function buildBvfApprovedStoragePath(input: {
  assetId: string;
  jobId: string;
  attemptId: string;
}): string {
  return `approved/${uuidSchema.parse(input.jobId)}/${uuidSchema.parse(input.attemptId)}/${uuidSchema.parse(input.assetId)}.mp4`;
}

function rpcArguments(input: RegisterReferenceInput) {
  return {
    p_asset_id: input.assetId,
    p_actor_id: input.actorId,
    p_asset_type: input.target.kind === "persona" ? "persona_reference" : "product_reference",
    p_persona_id: input.target.kind === "persona" ? input.target.personaId : null,
    p_produto_id: input.target.kind === "product" ? input.target.productId : null,
    p_reference_slot: input.target.kind === "persona" ? input.target.slot : null,
    p_storage_path: input.storagePath,
    p_mime_type: input.image.mimeType,
    p_width: input.image.width,
    p_height: input.image.height,
    p_checksum_sha256: input.image.checksumSha256,
    p_metadata: input.metadata,
  };
}

async function readAssetById(db: any, assetId: string) {
  return db.from("video_assets").select(ASSET_COLUMNS).eq("id", assetId).maybeSingle();
}

async function registerReference(db: any, input: RegisterReferenceInput) {
  const { data, error } = await db.rpc("bvf_register_reference_asset", rpcArguments(input));
  if (error) fail("BVF_STORAGE_REGISTER_FAILED", error);
  return rpcResultSchema.parse(data);
}

async function finishExistingRequest(db: any, input: RegisterReferenceInput) {
  const existing = await readAssetById(db, input.assetId);
  if (existing.error) fail("BVF_STORAGE_ASSET_READ_FAILED", existing.error);
  if (!existing.data) return null;
  await registerReference(db, input);
  return existing.data;
}

async function storeReference(input: RegisterReferenceInput) {
  const db: any = createServiceClient();
  const existing = await finishExistingRequest(db, input);
  if (existing) return { asset: existing, created: false };

  const upload = await db.storage.from(BVF_STORAGE_BUCKET).upload(
    input.storagePath,
    input.image.buffer,
    { contentType: input.image.mimeType, upsert: false, cacheControl: "3600" },
  );
  if (upload.error) {
    const concurrent = await finishExistingRequest(db, input);
    if (concurrent) return { asset: concurrent, created: false };
    fail("BVF_STORAGE_UPLOAD_FAILED", upload.error);
  }

  try {
    const registered = await registerReference(db, input);
    const stored = await readAssetById(db, input.assetId);
    if (stored.error || !stored.data) fail("BVF_STORAGE_ASSET_READ_FAILED", stored.error);
    return { asset: stored.data, created: registered.created ?? true };
  } catch (error) {
    const committed = await readAssetById(db, input.assetId);
    if (!committed.error && committed.data) {
      try {
        await registerReference(db, input);
        return { asset: committed.data, created: true };
      } catch (validationError) {
        const cleanup = await db.storage.from(BVF_STORAGE_BUCKET).remove([input.storagePath]);
        if (cleanup.error) fail("BVF_STORAGE_RECONCILIATION_REQUIRED", cleanup.error);
        throw validationError;
      }
    }
    if (committed.error) fail("BVF_STORAGE_RECONCILIATION_REQUIRED", committed.error);
    const cleanup = await db.storage.from(BVF_STORAGE_BUCKET).remove([input.storagePath]);
    if (cleanup.error) fail("BVF_STORAGE_RECONCILIATION_REQUIRED", cleanup.error);
    throw error;
  }
}

export async function uploadBvfReference(input: {
  actorId: string;
  requestId: string;
  target: BvfReferenceTarget;
  file: File;
}) {
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const image = await inspectBvfReferenceImage(buffer);
  const storagePath = buildBvfReferenceStoragePath(input.requestId, input.target, image.extension);
  return storeReference({
    assetId: uuidSchema.parse(input.requestId),
    actorId: uuidSchema.parse(input.actorId),
    target: input.target,
    image,
    storagePath,
    metadata: {
      source_kind: "manual_upload",
      original_file_name: safeOriginalName(input.file.name),
      uploaded_bytes: buffer.length,
    },
  });
}

export async function importBvfProductReference(input: {
  actorId: string;
  requestId: string;
  productId: string;
  sourceUrl: string;
  download?: (url: string) => Promise<Buffer>;
}) {
  const db: any = createServiceClient();
  const { data: product, error } = await db
    .from("produtos")
    .select("id,imagens")
    .eq("id", input.productId)
    .eq("ativo", true)
    .maybeSingle();
  if (error) fail("BVF_STORAGE_PRODUCT_READ_FAILED", error);
  if (!product) fail("BVF_STORAGE_ACTIVE_PRODUCT_NOT_FOUND");

  const sourceUrl = input.sourceUrl.trim();
  const images = Array.isArray(product.imagens)
    ? product.imagens.map((value: unknown) => String(value).trim()).filter(Boolean)
    : [];
  if (!images.includes(sourceUrl)) fail("BVF_STORAGE_PRODUCT_IMAGE_NOT_REGISTERED");

  const buffer = await (input.download ?? downloadBvfRemoteImage)(sourceUrl);
  const image = await inspectBvfReferenceImage(buffer);
  const target: BvfReferenceTarget = { kind: "product", productId: input.productId };
  const storagePath = buildBvfReferenceStoragePath(input.requestId, target, image.extension);
  const sourceName = new URL(sourceUrl).pathname.split("/").filter(Boolean).pop() ?? "product-image";
  return storeReference({
    assetId: uuidSchema.parse(input.requestId),
    actorId: uuidSchema.parse(input.actorId),
    target,
    image,
    storagePath,
    metadata: {
      source_kind: "product_catalog",
      source_url: sourceUrl,
      source_product_id: input.productId,
      original_file_name: safeOriginalName(sourceName),
      uploaded_bytes: buffer.length,
    },
  });
}

export async function listBvfReferences(filters: BvfReferenceListFilters) {
  const db: any = createServiceClient();
  let query = db
    .from("video_assets")
    .select(ASSET_COLUMNS)
    .order("active", { ascending: false })
    .order("created_at", { ascending: false });
  if (filters.personaId) {
    query = query.eq("asset_type", "persona_reference").eq("persona_id", filters.personaId);
  } else {
    query = query.eq("asset_type", "product_reference").eq("produto_id", filters.productId!);
  }
  if (!filters.includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) fail("BVF_STORAGE_REFERENCE_LIST_FAILED", error);
  return { data: data ?? [] };
}

export async function createBvfAssetSignedUrl(assetId: string) {
  const db: any = createServiceClient();
  const { data: asset, error } = await readAssetById(db, uuidSchema.parse(assetId));
  if (error) fail("BVF_STORAGE_ASSET_READ_FAILED", error);
  if (!asset) fail("BVF_STORAGE_ASSET_NOT_FOUND");
  const signed = await db.storage
    .from(BVF_STORAGE_BUCKET)
    .createSignedUrl(asset.storage_path, BVF_SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) fail("BVF_STORAGE_SIGNED_URL_FAILED", signed.error);
  return {
    assetId: asset.id,
    signedUrl: signed.data.signedUrl,
    expiresIn: BVF_SIGNED_URL_TTL_SECONDS,
  };
}

export async function deactivateBvfReference(input: {
  actorId: string;
  assetId: string;
  reason?: string;
}) {
  const db: any = createServiceClient();
  const { data, error } = await db.rpc("bvf_deactivate_reference_asset", {
    p_actor_id: uuidSchema.parse(input.actorId),
    p_asset_id: uuidSchema.parse(input.assetId),
    p_reason: input.reason?.trim() || null,
  });
  if (error) fail("BVF_STORAGE_DEACTIVATE_FAILED", error);
  const result = rpcResultSchema.parse(data);
  const stored = await readAssetById(db, result.assetId);
  if (stored.error || !stored.data) fail("BVF_STORAGE_ASSET_READ_FAILED", stored.error);
  return { asset: stored.data, changed: result.changed ?? false };
}
