-- Launchpad batch 4. Run once after 202610060003 as postgres.
-- Existing products stay private; private Storage buckets and prices stay private.
begin;
alter table public.products add column catalog_public boolean not null default false;
create index products_public_catalog_idx on public.products(company_id,created_at desc,id)
  where deleted_at is null and catalog_public;

create table public.catalog_links (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  created_by uuid not null references auth.users(id),
  token text not null unique check(token ~ '^[0-9a-f]{64}$'),
  label text not null default '' check(char_length(label)<=120),
  scope text not null check(scope in ('all','selected')),
  product_ids uuid[] not null default '{}',
  seller_name text not null,
  whatsapp text not null check(whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp()+interval '7 days',
  revoked_at timestamptz,
  check(expires_at=created_at+interval '7 days'),
  check((scope='all' and cardinality(product_ids)=0) or (scope='selected' and cardinality(product_ids) between 1 and 1000))
);
create index catalog_links_owner_idx on public.catalog_links(company_id,created_by,created_at desc);
alter table public.catalog_links enable row level security;
revoke all on public.catalog_links from public,anon,authenticated;
grant select on public.catalog_links to authenticated;
create policy catalog_links_read_owner_admin on public.catalog_links for select to authenticated using(
  public.jomsales_company_enabled(company_id) and exists(select 1 from public.company_members m
    where m.company_id=catalog_links.company_id and m.user_id=auth.uid() and m.active and m.removed_at is null
      and (m.role='admin' or catalog_links.created_by=auth.uid())));

create function public.search_catalog_share_products(target_company uuid,search_text text default '',after_created timestamptz default null,after_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare term text; result jsonb; matched bigint; published bigint;
begin
  if not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null) then
    raise exception 'Company access denied.' using errcode='42501'; end if;
  if search_text is null or char_length(search_text)>240 or (after_created is null)<>(after_id is null) then raise exception 'Invalid search or cursor.' using errcode='22023'; end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  select count(*),count(*) filter(where catalog_public) into matched,published from public.products where company_id=target_company and deleted_at is null and search_document like term;
  with page_rows as materialized (
    select id,serial,name,catalog_public,revision,created_at from public.products where company_id=target_company and deleted_at is null and search_document like term
      and (after_created is null or created_at<after_created or (created_at=after_created and id>after_id)) order by created_at desc,id limit 51
  ), visible as(select * from page_rows order by created_at desc,id limit 50)
  select jsonb_build_object('total',matched,'public_total',published,'items',coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,id) from visible v),'[]'::jsonb),
    'has_more',(select count(*)>50 from page_rows),'cursor',(select jsonb_build_object('created_at',created_at,'id',id) from visible order by created_at,id desc limit 1)) into result;
  return result;
end; $$;

create function public.set_catalog_visibility_batch(target_company uuid,search_text text,expected_count integer,visible boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare term text; ids uuid[]; changed integer;
begin
  perform public.salesgo_require_admin(target_company);
  if search_text is null or char_length(search_text)>240 or expected_count is null or expected_count not between 1 and 10000 or visible is null then
    raise exception 'Batch requires 1-10000 matching products.' using errcode='22023'; end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  -- Lock a bounded snapshot; concurrent product changes cannot expand the confirmed batch.
  select coalesce(array_agg(id),'{}'::uuid[]) into ids from (
    select id from public.products where company_id=target_company and deleted_at is null and search_document like term order by id limit 10001 for update
  ) matches;
  if cardinality(ids)<>expected_count then raise exception 'Matching products changed. Reload before bulk visibility.' using errcode='40001'; end if;
  update public.products set catalog_public=visible where id=any(ids) and company_id=target_company and catalog_public is distinct from visible;
  get diagnostics changed=row_count;return changed;
end; $$;

create function public.set_product_catalog_visibility(target_company uuid,target_product uuid,expected_revision integer,visible boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.products;
begin
  perform public.salesgo_require_admin(target_company);
  if visible is null then raise exception 'Visibility required.' using errcode='22023'; end if;
  update public.products set catalog_public=visible where id=target_product and company_id=target_company
    and revision=expected_revision and deleted_at is null returning * into result;
  if not found then raise exception 'Product changed. Reload before updating visibility.' using errcode='40001'; end if;
  return jsonb_build_object('id',result.id,'catalog_public',result.catalog_public,'revision',result.revision);
end; $$;

create function public.create_catalog_link(target_company uuid,request_id uuid,link_token text,link_label text,selected_ids uuid[] default null)
returns public.catalog_links language plpgsql security definer set search_path='' as $$
declare profile public.account_profiles; result public.catalog_links; ids uuid[]; kind text;
begin
  -- Serialize with company/member administration, and enforce live verified identity.
  perform 1 from public.companies where id=target_company for update;
  if not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id
    where m.company_id=target_company and m.user_id=auth.uid() and m.active and m.removed_at is null and u.email_confirmed_at is not null) then
    raise exception 'Company access denied.' using errcode='42501'; end if;
  if request_id is null or link_token is null or link_token !~ '^[0-9a-f]{64}$' or link_label is null or char_length(link_label)>120 then
    raise exception 'Invalid link request.' using errcode='22023'; end if;
  kind:=case when selected_ids is null then 'all' else 'selected' end;
  if kind='selected' and (cardinality(selected_ids) not between 1 and 1000 or array_position(selected_ids,null) is not null) then
    raise exception 'Select 1-1000 public products.' using errcode='22023'; end if;
  select coalesce(array_agg(v order by v),'{}'::uuid[]) into ids from (select distinct unnest(selected_ids) v) s;
  select * into result from public.catalog_links where id=request_id;
  if found then
    if result.company_id=target_company and result.created_by=auth.uid() and result.token=link_token and result.label=btrim(link_label)
      and result.scope=kind and result.product_ids=ids then return result; end if;
    raise exception 'Link request already exists with different contents.' using errcode='40001';
  end if;
  select * into profile from public.account_profiles where user_id=auth.uid();
  if profile.whatsapp is null or profile.whatsapp !~ '^\+[1-9][0-9]{7,14}$' or btrim(coalesce(profile.display_name,''))='' then
    raise exception 'Save your name and work WhatsApp with country code first.' using errcode='22023'; end if;
  if (select count(*) from public.catalog_links where company_id=target_company and created_by=auth.uid()
    and revoked_at is null and expires_at>statement_timestamp())>=100 then
    raise exception 'Too many active links. Revoke an old link first.' using errcode='22023'; end if;
  if kind='selected' and (select count(*) from public.products where company_id=target_company and deleted_at is null and catalog_public and id=any(ids))<>cardinality(ids) then
    raise exception 'Some selected products are not public or no longer available.' using errcode='22023'; end if;
  if kind='all' and not exists(select 1 from public.products where company_id=target_company and deleted_at is null and catalog_public) then
    raise exception 'No public products. Ask your administrator to allow products first.' using errcode='22023'; end if;
  insert into public.catalog_links(id,company_id,created_by,token,label,scope,product_ids,seller_name,whatsapp)
    values(request_id,target_company,auth.uid(),link_token,btrim(link_label),kind,ids,profile.display_name,profile.whatsapp) returning * into result;
  return result;
end; $$;

create function public.revoke_catalog_link(target_company uuid,target_link uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members m
    where m.company_id=target_company and m.user_id=auth.uid() and m.active and m.removed_at is null) then
    raise exception 'Company access denied.' using errcode='42501'; end if;
  update public.catalog_links l set revoked_at=coalesce(l.revoked_at,clock_timestamp()) where l.id=target_link and l.company_id=target_company
    and (l.created_by=auth.uid() or exists(select 1 from public.company_members m where m.company_id=target_company and m.user_id=auth.uid() and m.role='admin' and m.active and m.removed_at is null));
  if not found then raise exception 'Link unavailable.' using errcode='42501'; end if;
end; $$;

-- Only called by narrow SECURITY DEFINER APIs, not directly executable by visitors.
create function public.jomsales_live_catalog(link_token text)
returns public.catalog_links language sql stable security definer set search_path='' as $$
  select l from public.catalog_links l join public.company_members m on m.company_id=l.company_id and m.user_id=l.created_by
    join auth.users u on u.id=l.created_by join public.account_profiles p on p.user_id=l.created_by
  where link_token ~ '^[0-9a-f]{64}$' and l.token=link_token and l.revoked_at is null and l.expires_at>statement_timestamp()
    and public.jomsales_company_enabled(l.company_id) and m.active and m.removed_at is null and u.email_confirmed_at is not null and p.whatsapp=l.whatsapp
$$;

create function public.read_public_catalog(link_token text,search_text text default '',after_created timestamptz default null,after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare link public.catalog_links; term text; result jsonb; matched bigint;
begin
  link:=public.jomsales_live_catalog(link_token);
  if link.id is null then raise exception 'Catalog link unavailable.' using errcode='42501'; end if;
  if search_text is null or char_length(search_text)>240 or (after_created is null)<>(after_id is null) then
    raise exception 'Invalid search or cursor.' using errcode='22023'; end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  select count(*) into matched from public.products p where p.company_id=link.company_id and p.deleted_at is null and p.catalog_public
    and (link.scope='all' or p.id=any(link.product_ids)) and p.search_document like term;
  with page_rows as materialized (
    select p.id,p.serial,p.name,p.tags,p.unit,p.category,p.description,p.is_service,p.created_at,
      (p.image_path is not null or p.thumbnail_path is not null) as has_image
    from public.products p where p.company_id=link.company_id and p.deleted_at is null and p.catalog_public
      and (link.scope='all' or p.id=any(link.product_ids)) and p.search_document like term
      and (after_created is null or p.created_at<after_created or (p.created_at=after_created and p.id>after_id))
    order by p.created_at desc,p.id limit 51
  ), visible as(select * from page_rows order by created_at desc,id limit 50)
  select jsonb_build_object('company_name',(select name from public.companies where id=link.company_id),'seller_name',link.seller_name,
    'whatsapp',link.whatsapp,'expires_at',link.expires_at,'total',matched,'has_more',(select count(*)>50 from page_rows),
    'items',coalesce((select jsonb_agg(to_jsonb(v)-'created_at' order by created_at desc,id) from visible v),'[]'::jsonb),
    'cursor',(select jsonb_build_object('created_at',created_at,'id',id) from visible order by created_at,id desc limit 1)) into result;
  return result;
end; $$;

-- Returns only a currently public photo reference. No caller-controlled bucket/path.
create function public.public_catalog_image(link_token text,target_product uuid,full_image boolean default false)
returns text language plpgsql stable security definer set search_path='' as $$
declare link public.catalog_links; path text;
begin
  link:=public.jomsales_live_catalog(link_token);
  if link.id is null then raise exception 'Catalog link unavailable.' using errcode='42501'; end if;
  select case when full_image then coalesce(p.image_path,p.thumbnail_path) else coalesce(p.thumbnail_path,p.image_path) end into path
    from public.products p where p.company_id=link.company_id and p.id=target_product and p.catalog_public and p.deleted_at is null
      and (link.scope='all' or p.id=any(link.product_ids));
  if path is null then raise exception 'Catalog image unavailable.' using errcode='42501'; end if;
  return path;
end; $$;

create function public.public_catalog_inquiry(link_token text,target_product uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare link public.catalog_links; result jsonb;
begin
  link:=public.jomsales_live_catalog(link_token);
  if link.id is null then raise exception 'Catalog link unavailable.' using errcode='42501'; end if;
  select jsonb_build_object('whatsapp',link.whatsapp,'serial',p.serial,'name',p.name) into result from public.products p
    where p.company_id=link.company_id and p.id=target_product and p.catalog_public and p.deleted_at is null
      and (link.scope='all' or p.id=any(link.product_ids));
  if result is null then raise exception 'Catalog product unavailable.' using errcode='42501'; end if;
  return result;
end; $$;

-- Permanent revocation on disable/remove, even after restoring or re-inviting.
create function public.jomsales_revoke_member_catalogs() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not new.active or new.removed_at is not null then
    update public.catalog_links set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=new.company_id and created_by=new.user_id and revoked_at is null;
  end if; return new;
end; $$;
create trigger revoke_member_catalogs after update of active,removed_at on public.company_members for each row execute function public.jomsales_revoke_member_catalogs();
create function public.jomsales_revoke_company_catalogs() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.service_state not in ('trial','active') or old.service_state not in ('trial','active')
    or (new.service_until is not null and new.service_until<=statement_timestamp())
    or (old.service_until is not null and old.service_until<=statement_timestamp()) then
    update public.catalog_links set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=new.id and revoked_at is null;
  end if; return new;
end; $$;
create trigger revoke_company_catalogs after update of service_state,service_until on public.companies for each row execute function public.jomsales_revoke_company_catalogs();
create function public.jomsales_revoke_phone_catalogs() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.whatsapp is distinct from old.whatsapp then
    update public.catalog_links set revoked_at=coalesce(revoked_at,clock_timestamp()) where created_by=new.user_id and revoked_at is null;
  end if; return new;
end; $$;
create trigger revoke_phone_catalogs after update of whatsapp on public.account_profiles for each row execute function public.jomsales_revoke_phone_catalogs();

revoke all on function public.set_product_catalog_visibility(uuid,uuid,integer,boolean),public.set_catalog_visibility_batch(uuid,text,integer,boolean),public.create_catalog_link(uuid,uuid,text,text,uuid[]),
  public.revoke_catalog_link(uuid,uuid),public.jomsales_live_catalog(text),public.read_public_catalog(text,text,timestamptz,uuid),
  public.public_catalog_image(text,uuid,boolean),public.public_catalog_inquiry(text,uuid),public.search_catalog_share_products(uuid,text,timestamptz,uuid),
  public.jomsales_revoke_member_catalogs(),public.jomsales_revoke_company_catalogs(),public.jomsales_revoke_phone_catalogs() from public,anon,authenticated;
grant execute on function public.set_product_catalog_visibility(uuid,uuid,integer,boolean),public.set_catalog_visibility_batch(uuid,text,integer,boolean),public.create_catalog_link(uuid,uuid,text,text,uuid[]),public.revoke_catalog_link(uuid,uuid),public.search_catalog_share_products(uuid,text,timestamptz,uuid) to authenticated;
grant execute on function public.read_public_catalog(text,text,timestamptz,uuid),public.public_catalog_image(text,uuid,boolean),public.public_catalog_inquiry(text,uuid) to anon,authenticated;
commit;
