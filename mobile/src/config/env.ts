import { z } from "zod";

const envSchema = z.object({
  supabaseUrl: z.string().url(),
  supabasePublishableKey: z.string().min(1),
  apiUrl: z.string().url().transform((value) => value.replace(/\/$/, "")),
});

export const env = envSchema.parse({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
});
