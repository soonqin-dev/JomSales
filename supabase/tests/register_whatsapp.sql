-- Run in Supabase SQL Editor as postgres AFTER 202610070002_register_whatsapp.sql.
-- Every synthetic account is rolled back; no real profile is changed.
begin;
do $$
declare valid uuid:=gen_random_uuid(); bad uuid:=gen_random_uuid(); missing uuid:=gen_random_uuid(); long_name uuid:=gen_random_uuid(); row public.account_profiles;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (valid,'register-valid@test.invalid','{"display_name":"  Ryan  ","whatsapp":"+60123456789"}'),
    (bad,'register-bad@test.invalid','{"display_name":"Bad Phone","whatsapp":"0123456789"}'),
    (missing,'register-missing@test.invalid','{"display_name":"No Phone"}'),
    (long_name,'register-long@test.invalid',jsonb_build_object('display_name',repeat('x',121),'whatsapp','+60 12 345'));
  select * into row from public.account_profiles where user_id=valid;
  if row.display_name<>'Ryan' or row.whatsapp<>'+60123456789' then raise exception 'Valid sign-up WhatsApp not stored: %',row; end if;
  select * into row from public.account_profiles where user_id=bad;
  if row.whatsapp<>'' or row.display_name<>'Bad Phone' then raise exception 'Invalid WhatsApp must be stored empty: %',row; end if;
  select * into row from public.account_profiles where user_id=missing;
  if row.whatsapp<>'' then raise exception 'Missing WhatsApp must be empty: %',row; end if;
  select * into row from public.account_profiles where user_id=long_name;
  if row.display_name<>'' or row.whatsapp<>'' then raise exception 'Over-long name / spaced number handling changed: %',row; end if;
  if has_function_privilege('authenticated','public.jomsales_seed_profile()','EXECUTE') or has_function_privilege('anon','public.jomsales_seed_profile()','EXECUTE') then
    raise exception 'Seed trigger function must not be callable by clients'; end if;
end $$;
select 'PASS: sign-up WhatsApp is seeded only when valid; names unchanged' as result;
rollback;
