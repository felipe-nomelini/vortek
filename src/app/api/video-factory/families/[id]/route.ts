import { authorizeApiRequest } from "@/lib/api-request-auth";
import { getBvfFamily } from "@/services/video-factory/workflow";
import { bvfErrorResponse, bvfJson } from "../../_shared";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "video_factory.read");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    return bvfJson(await getBvfFamily(id));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
