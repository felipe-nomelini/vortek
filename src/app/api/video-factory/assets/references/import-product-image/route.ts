import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfProductImageImportSchema } from "@/lib/video-factory/storage-contracts";
import { importBvfProductReference } from "@/services/video-factory/storage";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  const parsed = bvfProductImageImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return bvfJson({ error: "Importação de imagem inválida", code: "BVF_INVALID_COMMAND" }, 422);
  }
  try {
    const result = await importBvfProductReference({
      actorId: auth.userId,
      requestId: parsed.data.requestId,
      productId: parsed.data.productId,
      sourceUrl: parsed.data.sourceUrl,
    });
    return bvfJson(result, result.created ? 201 : 200);
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
