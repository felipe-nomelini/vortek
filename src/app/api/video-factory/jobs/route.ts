import { authorizeApiRequest } from "@/lib/api-request-auth";
import { bvfCreateJobSchema, bvfJobListFiltersSchema } from "@/lib/video-factory/workflow-contracts";
import { createAndPrepareBvfJob, listBvfJobs } from "@/services/video-factory/workflow";
import { bvfErrorResponse, bvfJson } from "../_shared";

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.read");
  if (!auth.ok) return auth.response;
  const parsed = bvfJobListFiltersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return bvfJson({ error: "Filtros inválidos", code: "BVF_INVALID_FILTERS" }, 422);
  try {
    return bvfJson(await listBvfJobs(parsed.data, auth.userId));
  } catch (error) {
    return bvfErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, "video_factory.manage");
  if (!auth.ok) return auth.response;
  const parsed = bvfCreateJobSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bvfJson({ error: "Pedido de vídeo inválido", code: "BVF_INVALID_COMMAND" }, 422);
  try {
    const result = await createAndPrepareBvfJob(parsed.data, auth.userId);
    return bvfJson(result, result.created ? 201 : 200);
  } catch (error) {
    return bvfErrorResponse(error);
  }
}
