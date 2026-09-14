import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfReviewFamilySuggestionSchema } from "@/lib/video-factory/workflow-contracts";
import { reviewBvfFamilySuggestion } from "@/services/video-factory/families";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  const parsed = bvfReviewFamilySuggestionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bvfJson({ error: "Revisão inválida", code: "BVF_INVALID_COMMAND" }, 422);
  try {
    const { id } = await context.params;
    return bvfJson(await reviewBvfFamilySuggestion({ suggestionId: id, actorId: auth.userId, ...parsed.data }));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
