import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { getNotificationTemplatePreviews } from "@/lib/notifications/templates";
import { createClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const admin = await requireAdminUser(supabase);
  if (!admin.ok) return admin.response;

  return NextResponse.json(
    { templates: getNotificationTemplatePreviews() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
