-- SEC-01: authenticated users may edit personal profile fields, never authorization fields.
--
-- Exact rollback (reopens the SEC-01 privilege-escalation risk; do not apply without
-- explicit authorization):
--   revoke update (nome, avatar_url) on table public.profiles from authenticated;
--   grant update on table public.profiles to authenticated;

revoke update on table public.profiles from authenticated;
grant update (nome, avatar_url) on table public.profiles to authenticated;
