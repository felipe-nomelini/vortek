import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfSetFamilyMembersSchema } from "@/lib/video-factory/workflow-contracts";
import { setBvfFamilyMembers } from "@/services/video-factory/families";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  const parsed = bvfSetFamilyMembersSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bvfJson({ error: "Lista de produtos inválida", code: "BVF_INVALID_COMMAND" }, 422);
  try {
    const { id } = await context.params;
    return bvfJson(await setBvfFamilyMembers({ familyId: id, actorId: auth.userId, ...parsed.data }));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
