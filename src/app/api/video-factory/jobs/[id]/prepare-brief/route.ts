import { authorizeApiRequest } from "@/lib/api-request-auth";
import { getBvfJob, prepareBvfJobBrief } from "@/services/video-factory/workflow";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const brief = await prepareBvfJobBrief(id, auth.userId);
    return bvfJson({ brief, job: await getBvfJob(id, auth.userId) });
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
