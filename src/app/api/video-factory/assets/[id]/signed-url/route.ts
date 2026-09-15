import { z } from "zod";

import { authorizeApiRequest } from "@/lib/api-request-auth";
import { createBvfAssetSignedUrl } from "@/services/video-factory/storage";
import { bvfErrorResponse, bvfJson } from "../../../_shared";

const idSchema = z.string().uuid();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApiRequest(request, "video_factory.read");
  if (!auth.ok) return auth.response;
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) return bvfJson({ error: "Asset inválido", code: "BVF_INVALID_COMMAND" }, 422);
  try {
    return bvfJson(await createBvfAssetSignedUrl(parsed.data));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
