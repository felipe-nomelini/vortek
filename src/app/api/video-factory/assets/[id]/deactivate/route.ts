import { z } from "zod";

import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfDeactivateReferenceSchema } from "@/lib/video-factory/storage-contracts";
import { deactivateBvfReference } from "@/services/video-factory/storage";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

const idSchema = z.string().uuid();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  const id = idSchema.safeParse((await context.params).id);
  const body = bvfDeactivateReferenceSchema.safeParse(await request.json().catch(() => ({})));
  if (!id.success || !body.success) {
    return bvfJson({ error: "Desativação inválida", code: "BVF_INVALID_COMMAND" }, 422);
  }
  try {
    return bvfJson(await deactivateBvfReference({
      actorId: auth.userId,
      assetId: id.data,
      reason: body.data.reason,
    }));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
