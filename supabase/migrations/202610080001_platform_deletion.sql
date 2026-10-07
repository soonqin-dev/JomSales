-- Platform recycle bin for companies and accounts (docs/deletion-spec.md).
-- Only the platform owner (MFA-verified when required) can delete or restore.
-- Two stages: recycle bin for 30 days → permanent deletion (on expiry, or forced).
-- Companies keep a tombstone row (name, dates) so the platform audit stays intact.
-- Accounts are soft-deleted ("做法A"): the auth record stays; on purge the personal
-- profile is cleared and, when Supabase allows it, the e-mail is released.
begin;

alter table public.companies
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id),
  add column purge_after timestamptz,
  add column purged_at timestamptz;
alter table public.account_profiles
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id),
  add column purge_after timestamptz,
  add column purged_at timestamptz,
  add column email_hash text,
  add column login_blocked boolean not null default false,
  add column email_released boolean not null default false;

-- A company in the recycle bin behaves like a suspended company everywhere.
create or replace function public.jomsales_company_enabled(target_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.companies c where c.id=target_company and c.deleted_at is null
    and c.service_state in ('trial','active') and (c.service_until is null or c.service_until>statement_timestamp()))
$$;

create function public.jomsales_account_active(target_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.account_profiles p where p.user_id=target_user and p.deleted_at is not null)
$$;
revoke all on function public.jomsales_account_active(uuid) from public,anon,authenticated;
grant execute on function public.jomsales_account_active(uuid) to authenticated;
alter policy members_read_own_active_membership on public.company_members
  using(user_id=(select auth.uid()) and active and removed_at is null and public.jomsales_company_enabled(company_id)
    and public.jomsales_account_active(user_id));

-- A deleted account can never be (re)activated in any company, by any path.
create function public.jomsales_guard_deleted_member() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.active and not public.jomsales_account_active(new.user_id) then
    raise exception 'This account has been deleted.' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.jomsales_guard_deleted_member() from public,anon,authenticated;
create trigger jomsales_guard_deleted_member before insert or update of active on public.company_members
  for each row execute function public.jomsales_guard_deleted_member();

-- The account owner cannot edit a deleted profile (platform/cron cleanup still can).
create function public.jomsales_guard_deleted_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.deleted_at is not null and new.user_id=auth.uid() then
    raise exception 'This account has been deleted.' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function public.jomsales_guard_deleted_profile() from public,anon,authenticated;
create trigger jomsales_guard_deleted_profile before update on public.account_profiles
  for each row execute function public.jomsales_guard_deleted_profile();

-- ---------- Companies ----------
create function public.platform_trash_company(target_company uuid,confirm_name text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.companies;
begin
  perform public.jomsales_require_platform();
  select * into target from public.companies where id=target_company for update;
  if not found or target.deleted_at is not null then raise exception 'Company unavailable.' using errcode='22023'; end if;
  if confirm_name is null or btrim(confirm_name)<>target.name then raise exception 'Company name does not match.' using errcode='22023'; end if;
  update public.companies set deleted_at=clock_timestamp(),deleted_by=auth.uid(),purge_after=clock_timestamp()+interval '30 days',
    access_revision=access_revision+1 where id=target_company;
  update public.company_invitations set revoked_at=coalesce(revoked_at,now()) where company_id=target_company and accepted_at is null;
  update public.catalog_links set revoked_at=coalesce(revoked_at,now()) where company_id=target_company;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'company.trash',
    jsonb_build_object('name',target.name,'purge_after',clock_timestamp()+interval '30 days'));
end; $$;

create function public.platform_restore_company(target_company uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target public.companies;
begin
  perform public.jomsales_require_platform();
  select * into target from public.companies where id=target_company for update;
  if not found or target.deleted_at is null or target.purged_at is not null then raise exception 'Company is not in the recycle bin.' using errcode='22023'; end if;
  update public.companies set deleted_at=null,deleted_by=null,purge_after=null,access_revision=access_revision+1 where id=target_company;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'company.restore',jsonb_build_object('name',target.name));
end; $$;

-- Internal: permanent removal of every business row. The company row stays as a tombstone.
-- Storage files are removed through the Storage API by the platform page (never by SQL).
create function public.jomsales_purge_company(target_company uuid,actor uuid,reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare counts jsonb:='{}'; n bigint;
begin
  perform 1 from public.companies where id=target_company and deleted_at is not null and purged_at is null for update;
  if not found then raise exception 'Company is not in the recycle bin.' using errcode='22023'; end if;
  delete from public.quotation_events where company_id=target_company;
  delete from public.quotations where company_id=target_company; get diagnostics n=row_count; counts:=counts||jsonb_build_object('quotations',n);
  delete from public.quotation_number_reservations where company_id=target_company;
  delete from public.quotation_sequences where company_id=target_company;
  delete from public.quotation_defaults where company_id=target_company;
  delete from public.customers where company_id=target_company; get diagnostics n=row_count; counts:=counts||jsonb_build_object('customers',n);
  delete from public.catalog_links where company_id=target_company;
  delete from public.product_price_changes where company_id=target_company;
  delete from public.product_price_jobs where company_id=target_company;
  delete from public.product_import_rows where company_id=target_company;
  delete from public.product_number_reservations where company_id=target_company;
  delete from public.product_number_settings where company_id=target_company;
  delete from public.products where company_id=target_company; get diagnostics n=row_count; counts:=counts||jsonb_build_object('products',n);
  delete from public.company_categories where company_id=target_company;
  delete from public.company_invitations where company_id=target_company;
  delete from public.company_members where company_id=target_company; get diagnostics n=row_count; counts:=counts||jsonb_build_object('members',n);
  update public.companies set purged_at=clock_timestamp(),contact='',logo_path=null,access_revision=access_revision+1 where id=target_company;
  insert into public.platform_audit(actor,company_id,action,details) values(actor,target_company,reason,counts);
  return counts;
end; $$;
revoke all on function public.jomsales_purge_company(uuid,uuid,text) from public,anon,authenticated;

create function public.platform_purge_company(target_company uuid,confirm_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.companies;
begin
  perform public.jomsales_require_platform();
  select * into target from public.companies where id=target_company;
  if not found or target.deleted_at is null or target.purged_at is not null then raise exception 'Company is not in the recycle bin.' using errcode='22023'; end if;
  if confirm_name is null or btrim(confirm_name)<>target.name then raise exception 'Company name does not match.' using errcode='22023'; end if;
  return public.jomsales_purge_company(target_company,auth.uid(),'company.purge.forced');
end; $$;

-- Backup export, one page (200 rows) at a time. Includes quotations in the quote recycle bin.
create function public.platform_company_export(target_company uuid,kind text,page_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
  perform public.jomsales_require_platform();
  if page_offset<0 or not exists(select 1 from public.companies where id=target_company and purged_at is null) then raise exception 'Company unavailable.' using errcode='22023'; end if;
  if kind='quotations' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at,q.id),'[]') into rows from
      (select * from public.quotations where company_id=target_company order by created_at,id limit 200 offset page_offset) q;
  elsif kind='customers' then
    select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at,c.id),'[]') into rows from
      (select * from public.customers where company_id=target_company order by created_at,id limit 200 offset page_offset) c;
  elsif kind='products' then
    select coalesce(jsonb_agg(jsonb_build_object('serial',p.serial,'name',p.name,'price',p.price,'unit',p.unit,'category',p.category,
      'tags',p.tags,'description',p.description,'is_service',p.is_service,'deleted_at',p.deleted_at,'created_at',p.created_at) order by p.created_at,p.id),'[]') into rows from
      (select * from public.products where company_id=target_company order by created_at,id limit 200 offset page_offset) p;
  else raise exception 'Invalid export.' using errcode='22023'; end if;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'company.export',jsonb_build_object('kind',kind,'offset',page_offset,'rows',jsonb_array_length(rows)));
  return rows;
end; $$;

-- Storage object names of a deleted company, for removal through the Storage API.
create function public.platform_company_files(target_company uuid)
returns table(bucket_id text,name text) language plpgsql security definer set search_path='' as $$
begin
  perform public.jomsales_require_platform();
  if not exists(select 1 from public.companies where id=target_company and deleted_at is not null) then raise exception 'Company is not deleted.' using errcode='22023'; end if;
  return query select o.bucket_id::text,o.name::text from storage.objects o
    where o.bucket_id in ('salesgo-products','salesgo-branding') and split_part(o.name,'/',1)=target_company::text order by o.bucket_id,o.name limit 1000;
end; $$;

create policy platform_read_company_files on storage.objects for select to authenticated
  using(bucket_id in ('salesgo-products','salesgo-branding') and public.is_platform_admin());
create policy platform_remove_deleted_company_files on storage.objects for delete to authenticated
  using(bucket_id in ('salesgo-products','salesgo-branding') and public.is_platform_admin()
    and exists(select 1 from public.companies c where c.id::text=split_part(storage.objects.name,'/',1) and c.deleted_at is not null));

-- The company list gains deletion state and a scope: active | trash | purged.
drop function public.platform_list_companies(text,integer);
create function public.platform_list_companies(search_text text default '',page_offset integer default 0,list_scope text default 'active')
returns table(id uuid,name text,service_state text,service_until timestamptz,access_revision integer,
  plan text,employee_limit integer,product_limit integer,storage_limit_mb bigint,features jsonb,
  admin_email text,members bigint,products bigint,storage_bytes bigint,deleted_at timestamptz,purge_after timestamptz,purged_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform public.jomsales_require_platform();
  if page_offset<0 or char_length(search_text)>120 or list_scope not in ('active','trash','purged') then raise exception 'Invalid search.' using errcode='22023'; end if;
  return query select c.id,c.name,c.service_state,c.service_until,c.access_revision,e.plan,e.employee_limit,e.product_limit,e.storage_limit_mb,e.features,
    (select u.email::text from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=c.id and m.is_primary),
    (select count(*) from public.company_members m where m.company_id=c.id and m.removed_at is null),
    (select count(*) from public.products p where p.company_id=c.id and p.deleted_at is null),
    (select coalesce(sum(coalesce((to_jsonb(o)->'metadata'->>'size')::bigint,0)),0)::bigint from storage.objects o
      where o.bucket_id in ('salesgo-products','salesgo-branding') and split_part(o.name,'/',1)=c.id::text),
    c.deleted_at,c.purge_after,c.purged_at
    from public.companies c join public.company_entitlements e on e.company_id=c.id
    where position(lower(btrim(search_text)) in lower(c.name))>0
      and case list_scope when 'active' then c.deleted_at is null when 'trash' then c.deleted_at is not null and c.purged_at is null else c.purged_at is not null end
    order by c.created_at desc,c.id limit 50 offset page_offset;
end; $$;

-- ---------- Accounts (做法A) ----------
create function public.platform_list_accounts(search_text text default '',page_offset integer default 0,list_scope text default 'active')
returns table(user_id uuid,email text,display_name text,whatsapp text,created_at timestamptz,is_platform boolean,primary_companies text[],
  companies bigint,deleted_at timestamptz,purge_after timestamptz,purged_at timestamptz,login_blocked boolean,email_released boolean)
language plpgsql security definer set search_path='' as $$
begin
  perform public.jomsales_require_platform();
  if page_offset<0 or char_length(search_text)>254 or list_scope not in ('active','trash','purged') then raise exception 'Invalid search.' using errcode='22023'; end if;
  return query select u.id,u.email::text,coalesce(p.display_name,''),coalesce(p.whatsapp,''),u.created_at::timestamptz,
    exists(select 1 from public.platform_admins a where a.user_id=u.id),
    coalesce((select array_agg(c.name order by c.name) from public.company_members m join public.companies c on c.id=m.company_id
      where m.user_id=u.id and m.is_primary and c.purged_at is null),'{}'),
    (select count(*) from public.company_members m where m.user_id=u.id and m.active and m.removed_at is null),
    p.deleted_at,p.purge_after,p.purged_at,coalesce(p.login_blocked,false),coalesce(p.email_released,false)
    from auth.users u left join public.account_profiles p on p.user_id=u.id
    where (position(lower(btrim(search_text)) in lower(coalesce(u.email,'')))>0 or position(lower(btrim(search_text)) in lower(coalesce(p.display_name,'')))>0)
      and case list_scope when 'active' then p.deleted_at is null when 'trash' then p.deleted_at is not null and p.purged_at is null else p.purged_at is not null end
    order by u.created_at desc,u.id limit 50 offset page_offset;
end; $$;

create function public.platform_trash_account(target_user uuid,confirm_email text)
returns void language plpgsql security definer set search_path='' as $$
declare account_email text; blocked boolean:=false;
begin
  perform public.jomsales_require_platform();
  select u.email::text into account_email from auth.users u where u.id=target_user;
  if not found then raise exception 'Account unavailable.' using errcode='22023'; end if;
  if confirm_email is null or lower(btrim(confirm_email))<>lower(account_email) then raise exception 'Account e-mail does not match.' using errcode='22023'; end if;
  if exists(select 1 from public.platform_admins a where a.user_id=target_user) then raise exception 'Platform owner accounts cannot be deleted.' using errcode='42501'; end if;
  if exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id where m.user_id=target_user and m.is_primary and c.purged_at is null) then
    raise exception 'Transfer the primary administrator role before deleting this account.' using errcode='42501'; end if;
  insert into public.account_profiles(user_id) values(target_user) on conflict do nothing;
  perform 1 from public.account_profiles where user_id=target_user and deleted_at is null for update;
  if not found then raise exception 'Account is already deleted.' using errcode='22023'; end if;
  update public.company_members set active=false where user_id=target_user and active;
  update public.company_invitations i set revoked_at=coalesce(i.revoked_at,now()) where i.email=lower(account_email) and i.accepted_at is null;
  -- Block sign-in at the Auth level when this project allows it; the app blocks it regardless.
  begin
    execute 'update auth.users set banned_until=''infinity'' where id=$1' using target_user;
    blocked:=true;
  exception when others then blocked:=false;
  end;
  update public.account_profiles set deleted_at=clock_timestamp(),deleted_by=auth.uid(),purge_after=clock_timestamp()+interval '30 days',login_blocked=blocked
    where user_id=target_user;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),null,'account.trash',jsonb_build_object('user_id',target_user,'email',account_email,'login_blocked',blocked));
end; $$;

create function public.platform_restore_account(target_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target public.account_profiles;
begin
  perform public.jomsales_require_platform();
  select * into target from public.account_profiles where user_id=target_user for update;
  if not found or target.deleted_at is null or target.purged_at is not null then raise exception 'Account is not in the recycle bin.' using errcode='22023'; end if;
  begin execute 'update auth.users set banned_until=null where id=$1' using target_user; exception when others then null; end;
  update public.account_profiles set deleted_at=null,deleted_by=null,purge_after=null,login_blocked=false where user_id=target_user;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),null,'account.restore',jsonb_build_object('user_id',target_user));
end; $$;

-- Internal: clear personal data, keep the shell, release the e-mail when allowed.
create function public.jomsales_purge_account(target_user uuid,actor uuid,reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account_email text; released boolean:=false; placeholder text:='deleted-'||target_user::text||'@jomsales.invalid';
begin
  perform 1 from public.account_profiles where user_id=target_user and deleted_at is not null and purged_at is null for update;
  if not found then raise exception 'Account is not in the recycle bin.' using errcode='22023'; end if;
  select u.email::text into account_email from auth.users u where u.id=target_user;
  update public.company_members set active=false,removed_at=coalesce(removed_at,clock_timestamp()),role='sales',can_manage_products=false,is_primary=false
    where user_id=target_user;
  begin
    execute 'update auth.users set email=$2,raw_user_meta_data=''{}''::jsonb where id=$1' using target_user,placeholder;
    released:=true;
  exception when others then released:=false;
  end;
  if released then
    begin
      execute 'update auth.identities set identity_data=identity_data||jsonb_build_object(''email'',$2::text) where user_id=$1 and provider=''email''' using target_user,placeholder;
    exception when undefined_table then null;
    end;
  end if;
  update public.account_profiles set display_name='',whatsapp='',purged_at=clock_timestamp(),email_released=released,
    email_hash=case when account_email is null then null else encode(sha256(convert_to(lower(account_email),'UTF8')),'hex') end
    where user_id=target_user;
  insert into public.platform_audit(actor,company_id,action,details) values(actor,null,reason,jsonb_build_object('user_id',target_user,'email_released',released));
  return jsonb_build_object('email_released',released);
end; $$;
revoke all on function public.jomsales_purge_account(uuid,uuid,text) from public,anon,authenticated;

create function public.platform_purge_account(target_user uuid,confirm_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account_email text;
begin
  perform public.jomsales_require_platform();
  select u.email::text into account_email from auth.users u where u.id=target_user;
  if not found then raise exception 'Account unavailable.' using errcode='22023'; end if;
  if confirm_email is null or lower(btrim(confirm_email))<>lower(account_email) then raise exception 'Account e-mail does not match.' using errcode='22023'; end if;
  return public.jomsales_purge_account(target_user,auth.uid(),'account.purge.forced');
end; $$;

-- Cron (as postgres, hourly): permanent deletion once the 30 days have passed.
create function public.purge_expired_platform_deletions() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item uuid; companies bigint:=0; accounts bigint:=0;
begin
  for item in select id from public.companies where deleted_at is not null and purged_at is null and purge_after<=statement_timestamp() loop
    perform public.jomsales_purge_company(item,null,'company.purge.expired'); companies:=companies+1;
  end loop;
  for item in select user_id from public.account_profiles where deleted_at is not null and purged_at is null and purge_after<=statement_timestamp() loop
    perform public.jomsales_purge_account(item,null,'account.purge.expired'); accounts:=accounts+1;
  end loop;
  return jsonb_build_object('companies',companies,'accounts',accounts);
end; $$;
revoke all on function public.purge_expired_platform_deletions() from public,anon,authenticated;

do $$ declare f text; begin
  foreach f in array array['platform_trash_company(uuid,text)','platform_restore_company(uuid)','platform_purge_company(uuid,text)',
    'platform_company_export(uuid,text,integer)','platform_company_files(uuid)','platform_list_companies(text,integer,text)',
    'platform_list_accounts(text,integer,text)','platform_trash_account(uuid,text)','platform_restore_account(uuid)','platform_purge_account(uuid,text)'] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',f);
    execute format('grant execute on function public.%s to authenticated',f);
  end loop;
end $$;

commit;
