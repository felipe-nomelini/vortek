import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfBriefReviewSchema } from "@/lib/video-factory/ui-contracts";
import { reviewBvfJobBrief } from "@/services/video-factory/studio";
import { getBvfJob } from "@/services/video-factory/workflow";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  const parsed = bvfBriefReviewSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return bvfJson(
      { error: "Revisão de briefing inválida", code: "BVF_INVALID_COMMAND" },
      422,
    );
  }
  try {
    const { id } = await context.params;
    const review = await reviewBvfJobBrief(id, parsed.data, auth.userId);
    return bvfJson({ review, job: await getBvfJob(id, auth.userId) });
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
