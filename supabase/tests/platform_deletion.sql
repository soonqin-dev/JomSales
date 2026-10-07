-- Run in Supabase SQL Editor as postgres AFTER 202610080001_platform_deletion.sql.
-- Read-only checks; nothing is changed (rolled back).
begin;
do $$ declare f text; begin
  foreach f in array array['public.jomsales_purge_company(uuid,uuid,text)','public.jomsales_purge_account(uuid,uuid,text)','public.purge_expired_platform_deletions()'] loop
    if has_function_privilege('authenticated',f,'EXECUTE') or has_function_privilege('anon',f,'EXECUTE') then raise exception 'Internal purge function exposed: %',f; end if;
  end loop;
  foreach f in array array['public.platform_trash_company(uuid,text)','public.platform_purge_company(uuid,text)','public.platform_trash_account(uuid,text)',
    'public.platform_purge_account(uuid,text)','public.platform_company_export(uuid,text,integer)','public.platform_list_accounts(text,integer,text)'] loop
    if has_function_privilege('anon',f,'EXECUTE') then raise exception 'Visitor can call %',f; end if;
  end loop;
  if public.jomsales_company_enabled(gen_random_uuid()) then raise exception 'Unknown company reported enabled'; end if;
end $$;
select 'PASS: platform deletion functions are protected' as result;
rollback;

-- Optional: does this project allow account login blocking / e-mail release at the Auth level?
-- true = automatic; false = the app still blocks the account, and the e-mail must be freed by hand.
select has_table_privilege(current_user,'auth.users','UPDATE') as auth_users_update_allowed;
