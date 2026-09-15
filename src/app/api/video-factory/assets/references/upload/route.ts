import { authorizeApiRequest } from "@/lib/api-request-auth";
import {
  BVF_REFERENCE_MAX_BYTES,
  bvfReferenceUploadFieldsSchema,
} from "@/lib/video-factory/storage-contracts";
import { uploadBvfReference } from "@/services/video-factory/storage";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > BVF_REFERENCE_MAX_BYTES + 64 * 1024) {
    return bvfJson({ error: "A imagem deve ter no máximo 6 MB", code: "BVF_STORAGE_FILE_TOO_LARGE" }, 413);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return bvfJson({ error: "Upload inválido", code: "BVF_INVALID_COMMAND" }, 422);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return bvfJson({ error: "Selecione uma imagem", code: "BVF_INVALID_COMMAND" }, 422);
  }
  if (file.size > BVF_REFERENCE_MAX_BYTES) {
    return bvfJson({ error: "A imagem deve ter no máximo 6 MB", code: "BVF_STORAGE_FILE_TOO_LARGE" }, 413);
  }

  const targetType = String(form.get("targetType") ?? "");
  const target = targetType === "persona"
    ? {
        kind: "persona" as const,
        personaId: String(form.get("personaId") ?? ""),
        slot: String(form.get("slot") ?? ""),
      }
    : targetType === "product"
      ? { kind: "product" as const, productId: String(form.get("productId") ?? "") }
      : null;
  const parsed = bvfReferenceUploadFieldsSchema.safeParse({
    requestId: String(form.get("requestId") ?? ""),
    target,
  });
  if (!parsed.success) {
    return bvfJson({ error: "Destino da referência inválido", code: "BVF_INVALID_COMMAND" }, 422);
  }

  try {
    const result = await uploadBvfReference({
      actorId: auth.userId,
      requestId: parsed.data.requestId,
      target: parsed.data.target,
      file,
    });
    return bvfJson(result, result.created ? 201 : 200);
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
