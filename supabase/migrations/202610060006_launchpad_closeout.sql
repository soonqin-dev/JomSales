-- Launchpad closeout. Run once after 202610060005. Existing business data untouched.
begin;
create index quotations_history_cursor_idx on public.quotations(company_id,updated_at desc,id);
create function public.search_company_quotations(target_company uuid,search_text text default '',filter_status text default 'all',in_trash boolean default false,after_updated timestamptz default null,after_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare term text; result jsonb;
begin
  if not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null) then raise exception 'Company access denied.' using errcode='42501';end if;
  if search_text is null or char_length(search_text)>240 or filter_status is null or filter_status not in('all','pending','success','paid') or in_trash is null or (after_updated is null)<>(after_id is null) then raise exception 'Invalid quotation search.' using errcode='22023';end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with page_rows as materialized(
    select id,number,quote_date,customer_name,created_by,creator_email,creator_name,status,confirmed_at,paid_at,total_amount,deleted_at,revision,updated_at from public.quotations
    where company_id=target_company and (case when in_trash then deleted_at is not null else deleted_at is null end)
      and (filter_status='all' or status=filter_status) and lower(number||' '||customer_name||' '||coalesce(creator_name,'')||' '||coalesce(creator_email,'')) like term
      and (after_updated is null or updated_at<after_updated or (updated_at=after_updated and id>after_id)) order by updated_at desc,id limit 51
  ), visible as(select * from page_rows order by updated_at desc,id limit 50)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by updated_at desc,id) from visible v),'[]'::jsonb),
    'has_more',(select count(*)>50 from page_rows),'cursor',(select jsonb_build_object('updated_at',updated_at,'id',id) from visible order by updated_at,id desc limit 1)) into result;
  return result;
end; $$;
revoke all on function public.search_company_quotations(uuid,text,text,boolean,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.search_company_quotations(uuid,text,text,boolean,timestamptz,uuid) to authenticated;

-- Definer used only for the narrow owner-name join; authorization is explicit.
-- Direct customer read/write RLS and own-only editing remain unchanged.
create or replace function public.search_company_customers(target_company uuid,search_text text default '',include_inactive boolean default false,page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member_role text; term text; result jsonb;
begin
  if not public.jomsales_company_enabled(target_company) then raise exception 'Company access denied.' using errcode='42501';end if;
  select role into member_role from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null;
  if member_role is null then raise exception 'Company access denied.' using errcode='42501';end if;
  if search_text is null or char_length(search_text)>120 or page_offset is null or page_offset<0 or include_inactive is null then raise exception 'Invalid customer search.' using errcode='22023';end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with scoped as materialized(
    select c.id,c.company_id,c.created_by,c.name,c.company,c.phone,c.email,c.address,c.active,c.revision,c.created_at,
      coalesce(nullif(p.display_name,''),u.email::text,'姓名待补填') as owner_name,coalesce(u.email::text,'') as owner_email
    from public.customers c left join public.account_profiles p on p.user_id=c.created_by left join auth.users u on u.id=c.created_by
    where c.company_id=target_company and (member_role='admin' or c.created_by=auth.uid()) and (include_inactive or c.active)
  ), visible as materialized(select * from scoped where lower(name||' '||company||' '||phone||' '||email||' '||owner_name||' '||owner_email) like term),
    page as(select * from visible order by created_at desc,id limit 50 offset page_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id) from page p),'[]'::jsonb),'total',(select count(*) from visible)) into result;
  return result;
end; $$;
revoke all on function public.search_company_customers(uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.search_company_customers(uuid,text,boolean,integer) to authenticated;

create table public.company_categories(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),name text not null check(char_length(btrim(name)) between 1 and 80),active boolean not null default true,revision integer not null default 1);
create unique index company_categories_name_idx on public.company_categories(company_id,lower(btrim(name)));
create index products_category_filter_idx on public.products(company_id,lower(btrim(category))) where deleted_at is null;
insert into public.company_categories(company_id,name) select company_id,min(btrim(category)) from public.products where btrim(category)<>'' group by company_id,lower(btrim(category));
alter table public.company_categories enable row level security;
revoke all on public.company_categories from public,anon,authenticated;grant select on public.company_categories to authenticated;
create policy categories_members_read on public.company_categories for select to authenticated using(public.jomsales_company_enabled(company_id) and exists(select 1 from public.company_members m where m.company_id=company_categories.company_id and m.user_id=auth.uid() and m.active and m.removed_at is null));
create function public.list_company_categories(target_company uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null) then raise exception 'Company access denied.' using errcode='42501';end if;
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from (select id,name,active,revision,(select count(*) from public.products p where p.company_id=target_company and p.deleted_at is null and lower(btrim(p.category))=lower(btrim(c.name))) as product_count from public.company_categories c where c.company_id=target_company)c),'[]'::jsonb);
end; $$;
create function public.manage_company_category(target_company uuid,target_category uuid,category_name text,expected_revision integer,action text) returns public.company_categories language plpgsql security definer set search_path='' as $$
declare row public.company_categories;old_name text;
begin
  perform public.salesgo_require_admin(target_company);
  if target_category is null or action is null or action not in('create','rename','archive','restore') then raise exception 'Invalid category request.' using errcode='22023';end if;
  if action in('create','rename') and (category_name is null or char_length(btrim(category_name)) not between 1 and 80) then raise exception 'Category name requires 1-80 characters.' using errcode='22023';end if;
  select * into row from public.company_categories where id=target_category and company_id=target_company for update;
  if action='create' then
    if found then if row.name=btrim(category_name) and row.active then return row;end if;raise exception 'Category request changed.' using errcode='40001';end if;
    insert into public.company_categories(id,company_id,name) values(target_category,target_company,btrim(category_name)) returning * into row;return row;
  end if;
  if row.id is null or row.revision is distinct from expected_revision then raise exception 'Category changed. Reload first.' using errcode='40001';end if;
  old_name:=row.name;
  if action='rename' then
    if not row.active then raise exception 'Restore category before renaming.' using errcode='22023';end if;
    update public.company_categories set name=btrim(category_name),revision=revision+1 where id=row.id returning * into row;
    update public.products set category=row.name where company_id=target_company and deleted_at is null and lower(btrim(category))=lower(btrim(old_name));
  else update public.company_categories set active=(action='restore'),revision=revision+1 where id=row.id returning * into row;
  end if;return row;
end; $$;
create function public.jomsales_assign_category() returns trigger language plpgsql security definer set search_path='' as $$
declare found_category public.company_categories;member_role text;
begin
  new.category:=btrim(new.category);
  if tg_op='UPDATE' and lower(new.category)=lower(btrim(old.category)) then new.category:=old.category;return new;end if;
  if new.category='' then return new;end if;
  perform 1 from public.companies where id=new.company_id for update;
  if auth.uid() is not null then
    select role into member_role from public.company_members where company_id=new.company_id and user_id=auth.uid() and active and removed_at is null and (role='admin' or can_manage_products);
    if member_role is null or not public.jomsales_company_enabled(new.company_id) then raise exception 'Product management permission required.' using errcode='42501';end if;
  end if;
  select * into found_category from public.company_categories where company_id=new.company_id and lower(btrim(name))=lower(new.category);
  if not found then
    if auth.uid() is not null and member_role<>'admin' then raise exception 'Ask an administrator to create this category first.' using errcode='22023';end if;
    insert into public.company_categories(company_id,name) values(new.company_id,new.category) returning * into found_category;
  end if;
  if not found_category.active then raise exception 'Category is inactive. Pick an active category.' using errcode='22023';end if;
  new.category:=found_category.name;return new;
end; $$;
create trigger jomsales_assign_category before insert or update of category on public.products for each row execute function public.jomsales_assign_category();

-- New five-argument overloads preserve compatibility with earlier four-argument APIs.
create function public.search_company_products(target_company uuid,search_text text,after_created timestamptz,after_id uuid,category_filter text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare term text;page jsonb;matched bigint;
begin
  if not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null) then raise exception 'Company access denied.' using errcode='42501';end if;
  if search_text is null or char_length(search_text)>240 or char_length(category_filter)>80 or (after_created is null)<>(after_id is null) then raise exception 'Invalid search or cursor.' using errcode='22023';end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  select count(*) into matched from public.products p where p.company_id=target_company and p.deleted_at is null and p.search_document like term and (category_filter is null or lower(btrim(p.category))=lower(btrim(category_filter)));
  with page_rows as materialized(select p.id,p.company_id,p.serial,p.name,p.tags,p.price,p.image_path,p.thumbnail_path,p.image_hash,p.unit,p.category,p.description,p.is_service,p.source_key,p.revision,p.created_at from public.products p
    where p.company_id=target_company and p.deleted_at is null and p.search_document like term and (category_filter is null or lower(btrim(p.category))=lower(btrim(category_filter)))
      and (after_created is null or p.created_at<after_created or (p.created_at=after_created and p.id>after_id)) order by p.created_at desc,p.id limit 51),visible as(select * from page_rows order by created_at desc,id limit 50)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,id) from visible v),'[]'::jsonb),'total',matched,'has_more',(select count(*)>50 from page_rows),'cursor',(select jsonb_build_object('created_at',created_at,'id',id) from visible order by created_at,id desc limit 1)) into page;return page;
end; $$;
create function public.read_public_catalog(link_token text,search_text text,after_created timestamptz,after_id uuid,category_filter text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare link public.catalog_links;term text;result jsonb;matched bigint;categories jsonb;
begin
  link:=public.jomsales_live_catalog(link_token);if link.id is null then raise exception 'Catalog link unavailable.' using errcode='42501';end if;
  if search_text is null or char_length(search_text)>240 or char_length(category_filter)>80 or (after_created is null)<>(after_id is null) then raise exception 'Invalid search or cursor.' using errcode='22023';end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  -- Public options come ONLY from live/public products authorized by this link.
  select coalesce(jsonb_agg(name order by name),'[]'::jsonb) into categories from (select min(btrim(p.category)) name from public.products p where p.company_id=link.company_id and p.deleted_at is null and p.catalog_public and (link.scope='all' or p.id=any(link.product_ids)) group by lower(btrim(p.category)))c;
  select count(*) into matched from public.products p where p.company_id=link.company_id and p.deleted_at is null and p.catalog_public and (link.scope='all' or p.id=any(link.product_ids)) and p.search_document like term and (category_filter is null or lower(btrim(p.category))=lower(btrim(category_filter)));
  with page_rows as materialized(select p.id,p.serial,p.name,p.tags,p.unit,p.category,p.description,p.is_service,p.created_at,(p.image_path is not null or p.thumbnail_path is not null) has_image from public.products p
    where p.company_id=link.company_id and p.deleted_at is null and p.catalog_public and (link.scope='all' or p.id=any(link.product_ids)) and p.search_document like term and (category_filter is null or lower(btrim(p.category))=lower(btrim(category_filter)))
      and (after_created is null or p.created_at<after_created or (p.created_at=after_created and p.id>after_id)) order by p.created_at desc,p.id limit 51),visible as(select * from page_rows order by created_at desc,id limit 50)
  select jsonb_build_object('company_name',(select name from public.companies where id=link.company_id),'seller_name',link.seller_name,'whatsapp',link.whatsapp,'expires_at',link.expires_at,'categories',categories,'total',matched,'has_more',(select count(*)>50 from page_rows),'items',coalesce((select jsonb_agg(to_jsonb(v)-'created_at' order by created_at desc,id) from visible v),'[]'::jsonb),'cursor',(select jsonb_build_object('created_at',created_at,'id',id) from visible order by created_at,id desc limit 1)) into result;return result;
end; $$;
revoke all on function public.list_company_categories(uuid),public.manage_company_category(uuid,uuid,text,integer,text),public.jomsales_assign_category(),public.search_company_products(uuid,text,timestamptz,uuid,text),public.read_public_catalog(text,text,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.list_company_categories(uuid),public.manage_company_category(uuid,uuid,text,integer,text),public.search_company_products(uuid,text,timestamptz,uuid,text) to authenticated;
grant execute on function public.read_public_catalog(text,text,timestamptz,uuid,text) to anon,authenticated;
commit;
