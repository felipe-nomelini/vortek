import { GET as getTvMetrics } from "@/app/api/tv/metrics/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return getTvMetrics(request);
}
