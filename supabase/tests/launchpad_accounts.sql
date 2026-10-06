-- Read-only structural verification. No fixture accounts or physical files.
begin;
do $$
declare t text;
begin
  foreach t in array array['account_profiles','platform_admins','company_entitlements','platform_audit'] loop
    if not exists(select 1 from pg_tables where schemaname='public' and tablename=t and rowsecurity) then
      raise exception 'RLS missing: %',t;
    end if;
  end loop;
  if has_function_privilege('authenticated','public.create_company(text)','execute')
    or has_table_privilege('authenticated','public.platform_admins','insert')
    or has_table_privilege('authenticated','public.account_profiles','update')
    or has_table_privilege('anon','public.company_entitlements','select')
    or has_function_privilege('anon','public.platform_create_company(uuid,text,text,text)','execute') then
    raise exception 'Unexpected privileged API access.';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='company_members'
    and policyname='members_read_own_active_membership' and qual like '%jomsales_company_enabled%') then
    raise exception 'Membership suspension gate missing.';
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='one_primary_admin_per_company') then
    raise exception 'Primary uniqueness missing.';
  end if;
end; $$;
select 'PASS: Launchpad account tables/RLS, closed self-service company creation, platform restrictions and primary uniqueness' as result;
rollback;
