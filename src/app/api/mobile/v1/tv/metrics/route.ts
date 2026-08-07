import { unstable_noStore as noStore } from "next/cache";
import { GET as getTvMetrics } from "@/app/api/tv/metrics/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  noStore();
  return getTvMetrics(request);
}
