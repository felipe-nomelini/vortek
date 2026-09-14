import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfAuthorizeGenerationSchema } from "@/lib/video-factory/workflow-contracts";
import { authorizeBvfGeneration } from "@/services/video-factory/workflow";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  const parsed = bvfAuthorizeGenerationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bvfJson({ error: "Cotação inválida", code: "BVF_INVALID_COMMAND" }, 422);
  try {
    const { id } = await context.params;
    return bvfJson(await authorizeBvfGeneration(id, parsed.data, auth.userId));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
