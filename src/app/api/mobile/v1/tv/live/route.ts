import { GET as getTvLive } from "@/app/api/tv/live/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return getTvLive(request);
}
