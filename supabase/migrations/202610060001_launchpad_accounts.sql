-- Launchpad batch 1. Apply AFTER 202610040005, as postgres.
-- Preserves Auth accounts, companies, quotations, products and private buckets.
begin;

create table public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check(char_length(btrim(display_name))<=120),
  whatsapp text not null default '' check(whatsapp='' or whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  language text not null default 'zh' check(language in ('zh','en','ms')),
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.account_profiles enable row level security;
revoke all on public.account_profiles from public,anon,authenticated;
grant select on public.account_profiles to authenticated;
create policy profiles_read_self on public.account_profiles for select to authenticated using(user_id=(select auth.uid()));
-- No historical name is inferred from current profile data.
insert into public.account_profiles(user_id) select id from auth.users;
create function public.jomsales_seed_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare label text:=btrim(coalesce(to_jsonb(new)->'raw_user_meta_data'->>'display_name',''));
begin
  if char_length(label)>120 then label:=''; end if;
  insert into public.account_profiles(user_id,display_name) values(new.id,label) on conflict do nothing;
  return new;
end; $$;
revoke all on function public.jomsales_seed_profile() from public,anon,authenticated;
create trigger jomsales_seed_profile after insert on auth.users for each row execute function public.jomsales_seed_profile();

create function public.save_account_profile(profile_name text,work_whatsapp text,expected_revision integer)
returns public.account_profiles language plpgsql security definer set search_path='' as $$
declare result public.account_profiles;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
  if profile_name is null or char_length(btrim(profile_name)) not between 1 and 120
    or work_whatsapp is null or (work_whatsapp<>'' and work_whatsapp !~ '^\+[1-9][0-9]{7,14}$') then
    raise exception 'Name required (1-120 characters); WhatsApp must include country code, e.g. +60123456789.' using errcode='22023';
  end if;
  insert into public.account_profiles(user_id) values(auth.uid()) on conflict do nothing;
  update public.account_profiles set display_name=btrim(profile_name),whatsapp=work_whatsapp,
    revision=revision+1,updated_at=clock_timestamp()
    where user_id=auth.uid() and revision=expected_revision returning * into result;
  if not found then raise exception 'Profile changed. Reload before saving.' using errcode='40001'; end if;
  return result;
end; $$;

-- Seed only through SQL by the project owner, never user metadata or signup.
create table public.platform_admins (
  user_id uuid primary key references auth.users(id),
  active boolean not null default true,
  require_mfa boolean not null default false
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public,anon,authenticated;
create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.platform_admins p join auth.users u on u.id=p.user_id
    where p.user_id=auth.uid() and p.active and u.email_confirmed_at is not null
      and (not p.require_mfa or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal','')='aal2'))
$$;
create function public.jomsales_require_platform() returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_platform_admin() then raise exception 'Platform administrator access required.' using errcode='42501'; end if;
end; $$;

alter table public.companies add column service_state text not null default 'active'
  check(service_state in ('trial','active','expired','suspended')),
  add column service_until timestamptz,
  add column access_revision integer not null default 1;
alter table public.companies drop constraint companies_created_by_key;
alter table public.company_members add column is_primary boolean not null default false,
  add column removed_at timestamptz;
alter table public.company_members add constraint primary_must_be_admin check(not is_primary or (role='admin' and active and removed_at is null));
-- The recorded company creator, not an arbitrary employee, is the legacy primary.
update public.company_members m set is_primary=true from public.companies c
  where c.id=m.company_id and c.created_by=m.user_id and m.role='admin' and m.active;
create unique index one_primary_admin_per_company on public.company_members(company_id) where is_primary;

create table public.company_entitlements (
  company_id uuid primary key references public.companies(id),
  plan text not null default 'Lite' check(plan in ('Lite','Pro','Premium','Customize')),
  employee_limit integer check(employee_limit between 1 and 100000),
  product_limit integer check(product_limit between 1 and 10000000),
  storage_limit_mb bigint check(storage_limit_mb between 1 and 100000000),
  features jsonb not null default '{}' check(jsonb_typeof(features)='object'),
  revision integer not null default 1
);
insert into public.company_entitlements(company_id) select id from public.companies;
alter table public.company_entitlements enable row level security;
revoke all on public.company_entitlements from public,anon,authenticated;

create table public.platform_audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  company_id uuid references public.companies(id),
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.platform_audit enable row level security;
revoke all on public.platform_audit from public,anon,authenticated;

-- A narrow security-definer helper avoids recursive membership/company RLS.
create function public.jomsales_company_enabled(target_company uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.companies c where c.id=target_company
    and c.service_state in ('trial','active') and (c.service_until is null or c.service_until>statement_timestamp()))
$$;
alter policy members_read_own_active_membership on public.company_members
  using(user_id=(select auth.uid()) and active and removed_at is null and public.jomsales_company_enabled(company_id));
-- Existing product/quotation/Storage policies query this SELECT-only membership
-- table, so suspension blocks every existing direct Data/Storage API path.
create or replace function public.salesgo_require_admin(target_company uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.companies c where c.id=target_company for update;
  if not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members m
    where m.company_id=target_company and m.user_id=auth.uid() and m.active and m.removed_at is null and m.role='admin') then
    raise exception 'Administrator access required; company may be suspended or expired.' using errcode='42501';
  end if;
end; $$;
-- Close the old company-creation API, even for users calling it outside the UI.
create or replace function public.create_company(company_name text) returns uuid
language plpgsql security definer set search_path='' as $$
begin raise exception 'Company creation is managed by the platform owner.' using errcode='42501'; end; $$;
revoke all on function public.create_company(text) from public,anon,authenticated;

create function public.get_company_roster(target_company uuid)
returns table(user_id uuid,email text,display_name text,whatsapp text,role text,is_primary boolean,
  active boolean,removed_at timestamptz,can_manage_products boolean,joined_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform public.salesgo_require_admin(target_company);
  return query select m.user_id,u.email::text,coalesce(p.display_name,''),coalesce(p.whatsapp,''),
    m.role,m.is_primary,m.active,m.removed_at,m.can_manage_products,m.created_at
    from public.company_members m join auth.users u on u.id=m.user_id
    left join public.account_profiles p on p.user_id=m.user_id
    where m.company_id=target_company order by m.is_primary desc,m.created_at,m.user_id;
end; $$;

create function public.manage_company_member(target_company uuid,employee_id uuid,action text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.company_members; actor_primary boolean;
begin
  perform public.salesgo_require_admin(target_company);
  select m.is_primary into actor_primary from public.company_members m where m.company_id=target_company and m.user_id=auth.uid();
  select * into target from public.company_members m where m.company_id=target_company and m.user_id=employee_id for update;
  if not found or employee_id=auth.uid() or target.is_primary then
    raise exception 'Your own account and the primary administrator are protected.' using errcode='42501';
  end if;
  if (target.role='admin' or action in ('promote','demote')) and not actor_primary then
    raise exception 'Only the primary administrator can manage deputies.' using errcode='42501';
  end if;
  if target.removed_at is not null then raise exception 'Removed employees must rejoin by a new invitation.' using errcode='22023'; end if;
  if action='disable' then update public.company_members set active=false where company_id=target_company and user_id=employee_id;
  elsif action='enable' then update public.company_members set active=true where company_id=target_company and user_id=employee_id;
  elsif action='remove' then update public.company_members set active=false,removed_at=clock_timestamp(),can_manage_products=false,role='sales'
    where company_id=target_company and user_id=employee_id;
  elsif action='promote' and target.active then update public.company_members set role='admin',can_manage_products=false where company_id=target_company and user_id=employee_id;
  elsif action='demote' then update public.company_members set role='sales',can_manage_products=false where company_id=target_company and user_id=employee_id;
  else raise exception 'Invalid member operation.' using errcode='22023'; end if;
  if action in ('disable','remove','demote') then
    update public.company_invitations set revoked_at=coalesce(revoked_at,clock_timestamp())
      where company_id=target_company and (created_by=employee_id or accepted_by=employee_id);
  end if;
  insert into public.platform_audit(actor,company_id,action,details)
    values(auth.uid(),target_company,'member.'||action,jsonb_build_object('user_id',employee_id));
end; $$;
-- Old clients cannot use the old RPC to bypass deputy/removed-member guards.
create or replace function public.set_employee_active(target_company uuid,employee_id uuid,enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if enabled is null then raise exception 'Invalid permission.' using errcode='22023'; end if;
  perform public.manage_company_member(target_company,employee_id,case when enabled then 'enable' else 'disable' end);
end; $$;
create or replace function public.set_employee_product_permission(target_company uuid,employee_id uuid,enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.salesgo_require_admin(target_company);
  if enabled is null then raise exception 'Invalid permission.' using errcode='22023'; end if;
  update public.company_members set can_manage_products=enabled
    where company_id=target_company and user_id=employee_id and role='sales' and removed_at is null;
  if not found then raise exception 'Sales employee not found.' using errcode='22023'; end if;
end; $$;

alter table public.company_invitations add column invite_role text not null default 'sales' check(invite_role in ('sales','primary'));
create function public.jomsales_inviter_valid(invitation public.company_invitations) returns boolean
language sql stable security definer set search_path='' as $$
  select public.jomsales_company_enabled(invitation.company_id) and (
    (invitation.invite_role='sales' and exists(select 1 from public.company_members m
      where m.company_id=invitation.company_id and m.user_id=invitation.created_by and m.active and m.removed_at is null and m.role='admin'))
    or (invitation.invite_role='primary' and exists(select 1 from public.platform_admins p where p.user_id=invitation.created_by and p.active)))
$$;
create or replace function public.create_employee_invite(target_company uuid,invited_email text,invite_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(btrim(invited_email)); hashed text; existing public.company_invitations; result uuid;
begin
  perform public.salesgo_require_admin(target_company);
  if normalized is null or char_length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid email or invitation token.' using errcode='22023'; end if;
  if exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id
    where m.company_id=target_company and lower(u.email)=normalized and m.removed_at is null) then
    raise exception 'Already a member. Manage the existing account instead.' using errcode='22023'; end if;
  hashed:=encode(sha256(convert_to(invite_token,'UTF8')),'hex');
  select * into existing from public.company_invitations where token_hash=hashed;
  if found then
    if existing.company_id=target_company and existing.email=normalized and existing.created_by=auth.uid()
      and existing.invite_role='sales' and existing.revoked_at is null and existing.accepted_at is null and existing.expires_at>now() then return existing.id; end if;
    raise exception 'Generate a new invitation.' using errcode='22023';
  end if;
  update public.company_invitations set revoked_at=coalesce(revoked_at,now()) where company_id=target_company and email=normalized and accepted_at is null;
  insert into public.company_invitations(company_id,email,token_hash,created_by) values(target_company,normalized,hashed,auth.uid()) returning id into result;
  return result;
end; $$;
create or replace function public.get_employee_invite(invite_token text)
returns table(company_id uuid,company_name text,email text,expires_at timestamptz,already_accepted boolean)
language plpgsql security definer set search_path='' as $$
declare current_email text;
begin
  select lower(u.email) into current_email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if current_email is null or invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then raise exception 'Use the verified invited email.' using errcode='42501'; end if;
  return query select i.company_id,c.name,i.email,i.expires_at,i.accepted_at is not null
    from public.company_invitations i join public.companies c on c.id=i.company_id
    where i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') and i.email=current_email
      and i.revoked_at is null and public.jomsales_inviter_valid(i)
      and ((i.accepted_at is null and i.expires_at>now()) or (i.accepted_by=auth.uid() and exists(
        select 1 from public.company_members m where m.company_id=i.company_id and m.user_id=auth.uid() and m.active and m.removed_at is null)));
  if not found then raise exception 'Invitation invalid, expired, revoked or for another email.' using errcode='42501'; end if;
end; $$;
create or replace function public.accept_employee_invite(invite_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare current_email text; invitation public.company_invitations; member public.company_members; seat_limit integer;
begin
  select lower(u.email) into current_email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if current_email is null or invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then raise exception 'Use the verified invited email.' using errcode='42501'; end if;
  select * into invitation from public.company_invitations where token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') and email=current_email;
  if not found then raise exception 'Invalid invitation.' using errcode='42501'; end if;
  perform 1 from public.companies c where c.id=invitation.company_id for update;
  select * into invitation from public.company_invitations where id=invitation.id for update;
  if invitation.revoked_at is not null or not public.jomsales_inviter_valid(invitation)
    or (invitation.accepted_at is null and invitation.expires_at<=now())
    or (invitation.accepted_at is not null and invitation.accepted_by is distinct from auth.uid()) then
    raise exception 'Invitation expired or revoked.' using errcode='42501'; end if;
  select * into member from public.company_members where company_id=invitation.company_id and user_id=auth.uid() for update;
  if found and member.removed_at is null then
    if not member.active then raise exception 'Company membership disabled.' using errcode='42501'; end if;
    if invitation.invite_role='primary' and not member.is_primary then
      raise exception 'Use platform primary transfer for an existing member.' using errcode='22023'; end if;
  else
    if invitation.accepted_at is not null then raise exception 'A new invitation is required after removal.' using errcode='42501'; end if;
    select employee_limit into seat_limit from public.company_entitlements where company_id=invitation.company_id;
    if seat_limit is not null and (select count(*) from public.company_members where company_id=invitation.company_id and removed_at is null)>=seat_limit then
      raise exception 'Company employee quota reached.' using errcode='22023'; end if;
    if invitation.invite_role='primary' and exists(select 1 from public.company_members where company_id=invitation.company_id and is_primary) then
      raise exception 'Primary administrator already assigned.' using errcode='22023'; end if;
    insert into public.company_members(company_id,user_id,role,is_primary)
      values(invitation.company_id,auth.uid(),case when invitation.invite_role='primary' then 'admin' else 'sales' end,invitation.invite_role='primary')
      on conflict(company_id,user_id) do update set role=excluded.role,is_primary=excluded.is_primary,active=true,removed_at=null,can_manage_products=false;
  end if;
  update public.company_invitations set accepted_at=coalesce(accepted_at,now()),accepted_by=auth.uid() where id=invitation.id;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),invitation.company_id,'member.join',jsonb_build_object('user_id',auth.uid()));
  return invitation.company_id;
end; $$;
-- New signature for the UI; keep the original RPC compatible with old clients.
create function public.get_join_invitation(invite_token text)
returns table(company_id uuid,company_name text,email text,expires_at timestamptz,already_accepted boolean,invite_role text)
language plpgsql security definer set search_path='' as $$
begin
  return query select verified.company_id,verified.company_name,verified.email,verified.expires_at,verified.already_accepted,i.invite_role
    from public.get_employee_invite(invite_token) verified join public.company_invitations i
    on i.token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') and i.company_id=verified.company_id;
end; $$;

create function public.platform_create_company(target_company uuid,company_name text,admin_email text,invite_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(btrim(admin_email)); hashed text; existing public.companies;
begin
  perform public.jomsales_require_platform();
  if target_company is null or company_name is null or char_length(btrim(company_name)) not between 1 and 120
    or normalized is null or char_length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid company or administrator invitation.' using errcode='22023'; end if;
  hashed:=encode(sha256(convert_to(invite_token,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtext(target_company::text));
  select * into existing from public.companies where id=target_company;
  if found then
    if existing.created_by=auth.uid() and existing.name=btrim(company_name) and exists(select 1 from public.company_invitations
      where company_id=target_company and email=normalized and token_hash=hashed and invite_role='primary' and revoked_at is null and accepted_at is null and expires_at>now()) then return target_company; end if;
    raise exception 'Request already used. Check existing company before retrying.' using errcode='22023';
  end if;
  insert into public.companies(id,name,created_by,service_state) values(target_company,btrim(company_name),auth.uid(),'trial');
  insert into public.company_entitlements(company_id) values(target_company);
  insert into public.company_invitations(company_id,email,token_hash,created_by,invite_role) values(target_company,normalized,hashed,auth.uid(),'primary');
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'company.create',jsonb_build_object('admin_email',normalized));
  return target_company;
end; $$;
create function public.platform_list_companies(search_text text default '',page_offset integer default 0)
returns table(id uuid,name text,service_state text,service_until timestamptz,access_revision integer,
  plan text,employee_limit integer,product_limit integer,storage_limit_mb bigint,features jsonb,
  admin_email text,members bigint,products bigint,storage_bytes bigint)
language plpgsql security definer set search_path='' as $$
begin
  perform public.jomsales_require_platform();
  if page_offset<0 or char_length(search_text)>120 then raise exception 'Invalid search.' using errcode='22023'; end if;
  return query select c.id,c.name,c.service_state,c.service_until,c.access_revision,e.plan,e.employee_limit,e.product_limit,e.storage_limit_mb,e.features,
    (select u.email::text from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=c.id and m.is_primary),
    (select count(*) from public.company_members m where m.company_id=c.id and m.removed_at is null),
    (select count(*) from public.products p where p.company_id=c.id and p.deleted_at is null),
    (select coalesce(sum(coalesce((to_jsonb(o)->'metadata'->>'size')::bigint,0)),0)::bigint from storage.objects o
      where o.bucket_id in ('salesgo-products','salesgo-branding') and split_part(o.name,'/',1)=c.id::text)
    from public.companies c join public.company_entitlements e on e.company_id=c.id
    where position(lower(btrim(search_text)) in lower(c.name))>0
    order by c.created_at desc,c.id limit 50 offset page_offset;
end; $$;
create function public.platform_update_company(target_company uuid,expected_revision integer,new_state text,new_until timestamptz,
  new_plan text,seats integer,product_cap integer,storage_mb bigint,feature_config jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare before_row public.companies; before_plan public.company_entitlements;
begin
  perform public.jomsales_require_platform();
  select * into before_row from public.companies where id=target_company for update;
  if not found or before_row.access_revision is distinct from expected_revision then raise exception 'Company changed. Reload first.' using errcode='40001'; end if;
  select * into before_plan from public.company_entitlements where company_id=target_company;
  if new_state is null or new_plan is null or feature_config is null
    or char_length(feature_config::text)>3000 or new_state not in ('trial','active','expired','suspended') or new_plan not in ('Lite','Pro','Premium','Customize') then raise exception 'Invalid company settings.' using errcode='22023'; end if;
  update public.companies set service_state=new_state,service_until=new_until,access_revision=access_revision+1 where id=target_company;
  update public.company_entitlements set plan=new_plan,employee_limit=seats,product_limit=product_cap,storage_limit_mb=storage_mb,features=feature_config,revision=revision+1 where company_id=target_company;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'company.configure',
    jsonb_build_object('before',jsonb_build_object('state',before_row.service_state,'until',before_row.service_until,'plan',before_plan.plan,'seats',before_plan.employee_limit,'products',before_plan.product_limit,'storage_mb',before_plan.storage_limit_mb,'features',before_plan.features),
      'after',jsonb_build_object('state',new_state,'until',new_until,'plan',new_plan,'seats',seats,'products',product_cap,'storage_mb',storage_mb,'features',feature_config)));
end; $$;
create function public.platform_company_members(target_company uuid)
returns table(user_id uuid,email text,display_name text,role text,is_primary boolean,active boolean,removed_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform public.jomsales_require_platform();
  return query select m.user_id,u.email::text,coalesce(p.display_name,''),m.role,m.is_primary,m.active,m.removed_at
    from public.company_members m join auth.users u on u.id=m.user_id left join public.account_profiles p on p.user_id=m.user_id
    where m.company_id=target_company order by m.is_primary desc,m.created_at;
end; $$;
create function public.platform_manage_member(target_company uuid,employee_id uuid,action text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.company_members;
begin
  perform public.jomsales_require_platform();
  perform 1 from public.companies where id=target_company for update;
  select * into target from public.company_members where company_id=target_company and user_id=employee_id for update;
  if not found or target.removed_at is not null then raise exception 'Member unavailable.' using errcode='22023'; end if;
  if action='make_primary' and target.active then
    update public.company_members set is_primary=false where company_id=target_company and is_primary;
    update public.company_members set role='admin',is_primary=true where company_id=target_company and user_id=employee_id;
    update public.company_invitations set revoked_at=coalesce(revoked_at,now()) where company_id=target_company and invite_role='primary';
  elsif target.is_primary then raise exception 'Transfer the primary role before disabling or removing this member.' using errcode='42501';
  elsif action='disable' then update public.company_members set active=false where company_id=target_company and user_id=employee_id;
  elsif action='enable' then update public.company_members set active=true where company_id=target_company and user_id=employee_id;
  elsif action='remove' then update public.company_members set active=false,removed_at=clock_timestamp(),role='sales',can_manage_products=false where company_id=target_company and user_id=employee_id;
  else raise exception 'Invalid operation.' using errcode='22023'; end if;
  if action in ('disable','remove') then update public.company_invitations set revoked_at=coalesce(revoked_at,now()) where company_id=target_company and (created_by=employee_id or accepted_by=employee_id); end if;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'platform.member.'||action,jsonb_build_object('user_id',employee_id));
end; $$;
create function public.platform_audit_list(target_company uuid)
returns table(id bigint,action text,actor uuid,details jsonb,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin perform public.jomsales_require_platform();
  return query select a.id,a.action,a.actor,a.details,a.created_at from public.platform_audit a where a.company_id=target_company order by a.id desc limit 100;
end; $$;
create function public.platform_primary_invite(target_company uuid,admin_email text,invite_token text)
returns void language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(btrim(admin_email)); hashed text;
begin
  perform public.jomsales_require_platform();
  perform 1 from public.companies where id=target_company for update;
  if not found or not public.jomsales_company_enabled(target_company) then raise exception 'Company unavailable.' using errcode='22023'; end if;
  if exists(select 1 from public.company_members where company_id=target_company and is_primary) then
    raise exception 'Primary already assigned. Use member transfer instead.' using errcode='22023'; end if;
  if normalized is null or char_length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation.' using errcode='22023'; end if;
  hashed:=encode(sha256(convert_to(invite_token,'UTF8')),'hex');
  if exists(select 1 from public.company_invitations where company_id=target_company and email=normalized and token_hash=hashed
    and created_by=auth.uid() and invite_role='primary' and revoked_at is null and accepted_at is null and expires_at>now()) then return; end if;
  update public.company_invitations set revoked_at=coalesce(revoked_at,now()) where company_id=target_company and invite_role='primary' and accepted_at is null;
  insert into public.company_invitations(company_id,email,token_hash,created_by,invite_role) values(target_company,normalized,hashed,auth.uid(),'primary');
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'company.primary_invite',jsonb_build_object('admin_email',normalized));
end; $$;

-- Security-definer quotation lifecycle must check suspension independently.
create or replace function public.manage_quotation(target_company uuid,target_quote uuid,expected_revision integer,action text)
returns public.quotations language plpgsql security definer set search_path='' as $$
declare result public.quotations; actor uuid:=auth.uid(); member_role text;
begin
  perform 1 from public.companies where id=target_company for share;
  if not public.jomsales_company_enabled(target_company) then raise exception 'Company unavailable.' using errcode='42501'; end if;
  select m.role into member_role from public.company_members m where m.company_id=target_company and m.user_id=actor and m.active and m.removed_at is null for share;
  if member_role is null then raise exception 'Company access denied.' using errcode='42501'; end if;
  select * into result from public.quotations q where q.id=target_quote and q.company_id=target_company for update;
  if not found or (member_role<>'admin' and result.created_by<>actor) then raise exception 'Quotation access denied.' using errcode='42501'; end if;
  if result.revision is distinct from expected_revision then raise exception 'Quotation changed. Refresh before retrying.' using errcode='40001'; end if;
  if action='restore' then
    if result.deleted_at is null or result.deleted_at<=clock_timestamp()-interval '15 days' then raise exception 'Quotation not recoverable.' using errcode='22023'; end if;
    update public.quotations set deleted_at=null where id=target_quote returning * into result;
  elsif action in ('pending','success','trash') then
    if result.deleted_at is not null then raise exception 'Restore before editing.' using errcode='22023'; end if;
    if action='trash' then update public.quotations set deleted_at=clock_timestamp() where id=target_quote returning * into result;
    else update public.quotations set status=action where id=target_quote returning * into result; end if;
  else raise exception 'Invalid quotation action.' using errcode='22023'; end if;
  return result;
end; $$;
alter table public.quotations add column creator_name text not null default '';
create or replace function public.stamp_quotation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    select jsonb_build_object('name',c.name,'contact',c.contact,'logo_path',c.logo_path) into new.company_snapshot from public.companies c where c.id=new.company_id;
    select coalesce(u.email,'') into new.creator_email from auth.users u where u.id=new.created_by;
    new.creator_name:=coalesce((select p.display_name from public.account_profiles p where p.user_id=new.created_by),'');
  else
    new.creator_name:=old.creator_name;
    new.creator_email:=old.creator_email;
    new.revision:=old.revision+1; new.updated_at:=clock_timestamp();
  end if;
  return new;
end; $$;

-- Revoke the default PUBLIC execute grant explicitly on EVERY new function.
revoke all on function public.save_account_profile(text,text,integer),public.is_platform_admin(),public.jomsales_require_platform(),
  public.jomsales_company_enabled(uuid),public.get_company_roster(uuid),public.manage_company_member(uuid,uuid,text),
  public.get_join_invitation(text),
  public.jomsales_inviter_valid(public.company_invitations),public.platform_create_company(uuid,text,text,text),
  public.platform_list_companies(text,integer),public.platform_update_company(uuid,integer,text,timestamptz,text,integer,integer,bigint,jsonb),
  public.platform_company_members(uuid),public.platform_manage_member(uuid,uuid,text),public.platform_audit_list(uuid),public.platform_primary_invite(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.save_account_profile(text,text,integer),public.is_platform_admin(),public.jomsales_company_enabled(uuid),
  public.get_join_invitation(text),
  public.get_company_roster(uuid),public.manage_company_member(uuid,uuid,text),public.platform_create_company(uuid,text,text,text),
  public.platform_list_companies(text,integer),public.platform_update_company(uuid,integer,text,timestamptz,text,integer,integer,bigint,jsonb),
  public.platform_company_members(uuid),public.platform_manage_member(uuid,uuid,text),public.platform_audit_list(uuid),public.platform_primary_invite(uuid,text,text) to authenticated;
commit;

-- These companies need an EXPLICIT primary designation by the platform owner.
select c.id,c.name from public.companies c where not exists(select 1 from public.company_members m where m.company_id=c.id and m.is_primary);
