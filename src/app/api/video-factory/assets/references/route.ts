import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfReferenceListFiltersSchema } from "@/lib/video-factory/storage-contracts";
import { listBvfReferences } from "@/services/video-factory/storage";
import { bvfErrorResponse, bvfJson } from "../../_shared";

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.read");
  if (!auth.ok) return auth.response;
  const parsed = bvfReferenceListFiltersSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return bvfJson({ error: "Filtro de referências inválido", code: "BVF_INVALID_FILTERS" }, 422);
  }
  try {
    return bvfJson(await listBvfReferences(parsed.data));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
