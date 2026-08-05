import { z } from "zod";
import { apiGet } from "@/api/client";

const mobileUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  name: z.string().min(1),
  role: z.enum(["admin", "gerente", "operador", "visualizador"]),
  avatarUrl: z.string().url().nullable(),
});

const sessionResponseSchema = z.object({
  data: z.object({
    user: mobileUserSchema,
    permissions: z.array(
      z.enum([
        "tv.read",
        "sales.read",
        "purchases.read",
        "sales.track",
        "sales.whatsapp_label.send",
        "sales.dslite.resume",
        "purchases.payment.confirm",
      ]),
    ),
  }),
  error: z.null(),
  meta: z.object({ requestId: z.string().min(1) }),
});

export type MobileUser = z.infer<typeof mobileUserSchema>;
export type MobileSession = z.infer<typeof sessionResponseSchema>["data"];

export async function getCurrentSession(): Promise<MobileSession> {
  const response = await apiGet<unknown>("/api/mobile/v1/session");
  return sessionResponseSchema.parse(response).data;
}
