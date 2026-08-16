type SupabaseServiceUrlEnv = {
  SUPABASE_SERVICE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

export function resolveSupabaseServiceUrl(
  env: SupabaseServiceUrlEnv = process.env as SupabaseServiceUrlEnv,
) {
  const internalUrl = String(env.SUPABASE_SERVICE_URL || "").trim();
  const publicUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  return internalUrl || publicUrl;
}
