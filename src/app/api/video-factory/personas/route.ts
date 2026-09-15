import { authorizeApiRequest } from "@/lib/api-request-auth";
import { listBvfStudioPersonas } from "@/services/video-factory/studio";
import { bvfErrorResponse, bvfJson } from "../_shared";

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.read");
  if (!auth.ok) return auth.response;
  try {
    return bvfJson(await listBvfStudioPersonas(auth.userId));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
