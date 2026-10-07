-- AUTH.REGISTER collects the work WhatsApp at sign-up (docs/auth-spec.md §6.1).
-- The seed trigger now also copies raw_user_meta_data.whatsapp into account_profiles
-- when it is a valid E.164 number; anything else is stored as '' so sign-up never fails.
-- Affects NEW accounts only: existing profiles and numbers are not touched.
create or replace function public.jomsales_seed_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  label text:=btrim(coalesce(to_jsonb(new)->'raw_user_meta_data'->>'display_name',''));
  phone text:=btrim(coalesce(to_jsonb(new)->'raw_user_meta_data'->>'whatsapp',''));
begin
  if char_length(label)>120 then label:=''; end if;
  if phone !~ '^\+[1-9][0-9]{7,14}$' then phone:=''; end if;
  insert into public.account_profiles(user_id,display_name,whatsapp) values(new.id,label,phone) on conflict do nothing;
  return new;
end; $$;
revoke all on function public.jomsales_seed_profile() from public,anon,authenticated;
