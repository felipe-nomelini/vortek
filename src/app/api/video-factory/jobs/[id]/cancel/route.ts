import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfCancelJobSchema } from "@/lib/video-factory/workflow-contracts";
import { cancelBvfJob } from "@/services/video-factory/workflow";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  const parsed = bvfCancelJobSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return bvfJson({ error: "Cancelamento inválido", code: "BVF_INVALID_COMMAND" }, 422);
  try {
    const { id } = await context.params;
    return bvfJson(await cancelBvfJob(id, auth.userId, parsed.data.reason));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
