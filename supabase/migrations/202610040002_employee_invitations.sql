-- Apply once after the company-accounts and cloud-products migrations.
-- No existing member/product records are changed. Run as postgres.
begin;

create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create index company_invitations_company_idx on public.company_invitations(company_id, created_at desc);
alter table public.company_invitations enable row level security;
-- Tokens/hashes are never listed through the Data API, even for admins.
revoke all on public.company_invitations from public, anon, authenticated;

-- Internal helper: serialize admin/accept operations for a company and recheck
-- live membership after acquiring its lock. Never executable by API callers.
create function public.salesgo_require_admin(target_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.company_members m where m.company_id=target_company
    and m.user_id=auth.uid() and m.active and m.role='admin') then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;
  perform 1 from public.companies c where c.id=target_company for update;
  if not exists(select 1 from public.company_members m where m.company_id=target_company
    and m.user_id=auth.uid() and m.active and m.role='admin') then
    raise exception 'Administrator access required.' using errcode='42501';
  end if;
end;
$$;

create function public.get_company_team(target_company uuid)
returns table(user_id uuid, email text, role text, active boolean, joined_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.salesgo_require_admin(target_company);
  return query select m.user_id, u.email::text, m.role, m.active, m.created_at
    from public.company_members m join auth.users u on u.id=m.user_id
    where m.company_id=target_company order by m.created_at, m.user_id;
end;
$$;

create function public.get_company_invitations(target_company uuid)
returns table(id uuid, email text, created_at timestamptz, expires_at timestamptz, revoked_at timestamptz, accepted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.salesgo_require_admin(target_company);
  return query select i.id, i.email, i.created_at, i.expires_at, i.revoked_at, i.accepted_at
    from public.company_invitations i where i.company_id=target_company order by i.created_at desc, i.id;
end;
$$;

create function public.create_employee_invite(target_company uuid, invited_email text, invite_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  normalized_email text := lower(btrim(invited_email));
  hashed_token text;
  existing public.company_invitations;
  invitation_id uuid;
begin
  perform public.salesgo_require_admin(target_company);
  if normalized_email is null or char_length(normalized_email)>254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid employee email.' using errcode='22023';
  end if;
  if invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation token.' using errcode='22023';
  end if;
  if exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id
    where m.company_id=target_company and lower(u.email)=normalized_email) then
    raise exception 'This employee is already a member. Use the team list to manage access.' using errcode='22023';
  end if;
  hashed_token := encode(sha256(convert_to(invite_token, 'UTF8')), 'hex');
  select * into existing from public.company_invitations i where i.token_hash=hashed_token;
  if found then
    if existing.company_id=target_company and existing.email=normalized_email and existing.created_by=auth.uid()
      and existing.revoked_at is null and existing.accepted_at is null and existing.expires_at>now() then
      return existing.id; -- Safe retry when the first response was lost.
    end if;
    raise exception 'Generate a new invitation link.' using errcode='22023';
  end if;
  update public.company_invitations i set revoked_at=now()
    where i.company_id=target_company and i.email=normalized_email and i.revoked_at is null and i.accepted_at is null;
  insert into public.company_invitations(company_id,email,token_hash,created_by)
    values(target_company, normalized_email, hashed_token, auth.uid()) returning id into invitation_id;
  return invitation_id;
end;
$$;

create function public.revoke_employee_invite(target_company uuid, invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.salesgo_require_admin(target_company);
  update public.company_invitations i set revoked_at=coalesce(i.revoked_at, now())
    where i.company_id=target_company and i.id=invitation_id and i.accepted_at is null;
  if not found then raise exception 'Invitation not found or already accepted.' using errcode='22023'; end if;
end;
$$;

create function public.set_employee_active(target_company uuid, employee_id uuid, enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.salesgo_require_admin(target_company);
  if enabled is null or employee_id=auth.uid() then
    raise exception 'You cannot disable your own account.' using errcode='22023';
  end if;
  update public.company_members m set active=enabled
    where m.company_id=target_company and m.user_id=employee_id and m.role='sales';
  if not found then raise exception 'Sales employee not found. Administrator accounts are protected.' using errcode='22023'; end if;
end;
$$;

create function public.get_employee_invite(invite_token text)
returns table(company_id uuid, company_name text, email text, expires_at timestamptz, already_accepted boolean)
language plpgsql security definer set search_path = '' as $$
declare current_email text;
begin
  select lower(u.email) into current_email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if current_email is null or invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Sign in with the verified invited email.' using errcode='42501';
  end if;
  return query select i.company_id, c.name, i.email, i.expires_at, i.accepted_at is not null
    from public.company_invitations i join public.companies c on c.id=i.company_id
    where i.token_hash=encode(sha256(convert_to(invite_token, 'UTF8')), 'hex') and i.email=current_email
      and i.revoked_at is null
      and ((i.accepted_at is null and i.expires_at>now()) or i.accepted_by=auth.uid())
      and exists(select 1 from public.company_members m where m.company_id=i.company_id and m.user_id=i.created_by and m.active and m.role='admin');
  if not found then raise exception 'Invitation invalid, expired, revoked or for another email.' using errcode='42501'; end if;
end;
$$;

create function public.accept_employee_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  current_email text;
  invitation public.company_invitations;
  membership public.company_members;
  hashed_token text;
begin
  select lower(u.email) into current_email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if current_email is null or invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Sign in with the verified invited email.' using errcode='42501';
  end if;
  hashed_token := encode(sha256(convert_to(invite_token, 'UTF8')), 'hex');
  select * into invitation from public.company_invitations i where i.token_hash=hashed_token and i.email=current_email;
  if not found then raise exception 'Invitation invalid or for another email.' using errcode='42501'; end if;
  perform 1 from public.companies c where c.id=invitation.company_id for update;
  select * into invitation from public.company_invitations i where i.token_hash=hashed_token for update;
  if invitation.revoked_at is not null or (invitation.accepted_at is null and invitation.expires_at<=now())
    or (invitation.accepted_at is not null and invitation.accepted_by is distinct from auth.uid())
    or not exists(select 1 from public.company_members m where m.company_id=invitation.company_id
      and m.user_id=invitation.created_by and m.active and m.role='admin') then
    raise exception 'Invitation expired or revoked.' using errcode='42501';
  end if;
  select * into membership from public.company_members m where m.company_id=invitation.company_id and m.user_id=auth.uid();
  if found and not membership.active then
    raise exception 'Company access is disabled. Ask the administrator to enable it.' using errcode='42501';
  end if;
  insert into public.company_members(company_id,user_id,role) values(invitation.company_id,auth.uid(),'sales') on conflict do nothing;
  update public.company_invitations i set accepted_at=coalesce(i.accepted_at,now()), accepted_by=auth.uid() where i.id=invitation.id;
  return invitation.company_id;
end;
$$;

revoke all on function public.salesgo_require_admin(uuid) from public, anon, authenticated;
revoke all on function public.get_company_team(uuid), public.get_company_invitations(uuid),
  public.create_employee_invite(uuid,text,text), public.revoke_employee_invite(uuid,uuid),
  public.set_employee_active(uuid,uuid,boolean), public.get_employee_invite(text),
  public.accept_employee_invite(text) from public, anon, authenticated;
grant execute on function public.get_company_team(uuid), public.get_company_invitations(uuid),
  public.create_employee_invite(uuid,text,text), public.revoke_employee_invite(uuid,uuid),
  public.set_employee_active(uuid,uuid,boolean), public.get_employee_invite(text),
  public.accept_employee_invite(text) to authenticated;
commit;

select tablename, rowsecurity as row_security_enabled from pg_tables
  where schemaname='public' and tablename='company_invitations';
