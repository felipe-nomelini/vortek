import { authorizeApiRequest } from "@/lib/api-request-auth";
import { getBvfStudioProductBySku } from "@/services/video-factory/studio";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.read");
  if (!auth.ok) return auth.response;
  const sku = new URL(request.url).searchParams.get("sku") ?? "";
  try {
    return bvfJson(await getBvfStudioProductBySku(sku, auth.userId));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
