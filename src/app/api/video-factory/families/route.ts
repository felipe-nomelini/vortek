import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfFamilyListFiltersSchema } from "@/lib/video-factory/workflow-contracts";
import { listBvfFamilies } from "@/services/video-factory/workflow";
import { bvfErrorResponse, bvfJson } from "../_shared";

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.read");
  if (!auth.ok) return auth.response;
  const parsed = bvfFamilyListFiltersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return bvfJson({ error: "Filtros inválidos", code: "BVF_INVALID_FILTERS" }, 422);
  try {
    return bvfJson(await listBvfFamilies(parsed.data));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
