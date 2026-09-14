import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfSuggestFamilySchema, bvfSuggestionListFiltersSchema } from "@/lib/video-factory/workflow-contracts";
import { suggestBvfFamily } from "@/services/video-factory/families";
import { listBvfFamilySuggestions } from "@/services/video-factory/workflow";
import { bvfErrorResponse, bvfJson } from "../_shared";

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.read");
  if (!auth.ok) return auth.response;
  const parsed = bvfSuggestionListFiltersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return bvfJson({ error: "Filtros inválidos", code: "BVF_INVALID_FILTERS" }, 422);
  try {
    return bvfJson(await listBvfFamilySuggestions(parsed.data));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  const parsed = bvfSuggestFamilySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bvfJson({ error: "Produto inicial inválido", code: "BVF_INVALID_COMMAND" }, 422);
  try {
    const result = await suggestBvfFamily({ ...parsed.data, actorId: auth.userId });
    return bvfJson(result, result.created ? 201 : 200);
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
