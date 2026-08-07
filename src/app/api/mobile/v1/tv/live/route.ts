import { unstable_noStore as noStore } from "next/cache";
import { GET as getTvLive } from "@/app/api/tv/live/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  noStore();
  return getTvLive(request);
}
