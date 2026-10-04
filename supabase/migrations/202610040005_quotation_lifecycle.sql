-- Run ONCE as postgres after 202610040004. Existing quotes default to Pending.
-- No existing quotations are deleted by this migration.
begin;
alter table public.quotations
  add column status text not null default 'pending' check(status in ('pending','success')),
  add column deleted_at timestamptz,
  add column creator_email text not null default '';
update public.quotations q set creator_email=coalesce(u.email,'') from auth.users u where u.id=q.created_by;
create index quotations_trash_expiry_idx on public.quotations(deleted_at) where deleted_at is not null;

create or replace function public.stamp_quotation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    select jsonb_build_object('name',c.name,'contact',c.contact,'logo_path',c.logo_path)
      into new.company_snapshot from public.companies c where c.id=new.company_id;
    select coalesce(u.email,'') into new.creator_email from auth.users u where u.id=new.created_by;
  else
    new.revision:=old.revision+1;
    new.updated_at:=clock_timestamp();
  end if;
  return new;
end;
$$;

-- Clients may read recoverable trash but may not edit its contents or write
-- lifecycle/ownership fields directly. Lifecycle changes use the locked RPC.
drop policy members_read_scoped_quotes on public.quotations;
create policy members_read_scoped_quotes on public.quotations for select to authenticated
using((deleted_at is null or deleted_at>statement_timestamp()-interval '15 days') and exists(
  select 1 from public.company_members m where m.company_id=quotations.company_id
    and m.user_id=(select auth.uid()) and m.active and (m.role='admin' or quotations.created_by=(select auth.uid()))));
drop policy members_update_scoped_quotes on public.quotations;
create policy members_update_scoped_quotes on public.quotations for update to authenticated
using(deleted_at is null and exists(select 1 from public.company_members m where m.company_id=quotations.company_id
  and m.user_id=(select auth.uid()) and m.active and (m.role='admin' or quotations.created_by=(select auth.uid()))))
with check(deleted_at is null and exists(select 1 from public.company_members m where m.company_id=quotations.company_id
  and m.user_id=(select auth.uid()) and m.active and (m.role='admin' or quotations.created_by=(select auth.uid()))));

create function public.manage_quotation(target_company uuid,target_quote uuid,expected_revision integer,action text)
returns public.quotations language plpgsql security definer set search_path='' as $$
declare result public.quotations; actor uuid:=auth.uid(); member_role text;
begin
  select m.role into member_role from public.company_members m where m.company_id=target_company and m.user_id=actor and m.active for share;
  if member_role is null then raise exception 'Company access denied.' using errcode='42501'; end if;
  select * into result from public.quotations q where q.id=target_quote and q.company_id=target_company for update;
  if not found or (member_role<>'admin' and result.created_by<>actor) then
    raise exception 'Quotation access denied.' using errcode='42501';
  end if;
  if result.revision is distinct from expected_revision then
    raise exception 'Quotation changed. Refresh before retrying.' using errcode='40001';
  end if;
  if action='restore' then
    if result.deleted_at is null or result.deleted_at<=clock_timestamp()-interval '15 days' then
      raise exception 'Quotation is not recoverable.' using errcode='22023';
    end if;
    update public.quotations set deleted_at=null where id=target_quote returning * into result;
  elsif action in ('pending','success','trash') then
    if result.deleted_at is not null then raise exception 'Restore quotation before editing.' using errcode='22023'; end if;
    if action='trash' then
      update public.quotations set deleted_at=clock_timestamp() where id=target_quote returning * into result;
    else
      update public.quotations set status=action where id=target_quote returning * into result;
    end if;
  else raise exception 'Invalid quotation action.' using errcode='22023';
  end if;
  return result;
end;
$$;
revoke all on function public.manage_quotation(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.manage_quotation(uuid,uuid,integer,text) to authenticated;

-- Cron runs this as postgres. Never expose permanent deletion to the browser.
create function public.purge_expired_quotations() returns bigint
language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
  delete from public.quotations where deleted_at<=statement_timestamp()-interval '15 days';
  get diagnostics removed=row_count;
  return removed;
end;
$$;
revoke all on function public.purge_expired_quotations() from public,anon,authenticated;
commit;
select column_name,data_type from information_schema.columns
where table_schema='public' and table_name='quotations' and column_name in ('status','deleted_at','creator_email');
