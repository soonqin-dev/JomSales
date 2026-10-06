-- Run AFTER 202610060001_launchpad_accounts.sql in Supabase SQL Editor.
-- Replace the email below with YOUR verified login email, never a customer's.
-- Do not run this through a browser client. Only the project owner can run it.
begin;
do $$
declare owner_email text:='REPLACE_WITH_YOUR_VERIFIED_EMAIL'; owner_id uuid;
begin
  if owner_email='REPLACE_WITH_YOUR_VERIFIED_EMAIL' then raise exception 'Replace owner_email with your verified email first.'; end if;
  select id into strict owner_id from auth.users where lower(email)=lower(btrim(owner_email)) and email_confirmed_at is not null;
  insert into public.platform_admins(user_id,active) values(owner_id,true)
    on conflict(user_id) do update set active=true;
end; $$;
commit;
-- Shows only account ID and enforcement flag, not passwords or API keys.
select user_id,active,require_mfa from public.platform_admins;

-- After you have enrolled a TOTP authenticator in /settings and tested its code,
-- enforce it by running the following with your verified email substituted:
-- update public.platform_admins set require_mfa=true
-- where user_id=(select id from auth.users where lower(email)=lower('YOUR_EMAIL'));
-- At later logins, verify the authenticator in /settings before /platform.
