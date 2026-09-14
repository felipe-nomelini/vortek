import { authorizeApiRequest } from "@/lib/api-request-auth";
import { analyzeBvfFamily } from "@/services/video-factory/families";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    return bvfJson(await analyzeBvfFamily({ familyId: id, actorId: auth.userId, signal: request.signal }));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
