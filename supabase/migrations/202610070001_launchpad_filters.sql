-- Apply once after 202610060006. Read/query changes only, no business rows deleted.
begin;
-- Preserve the existing authorization/field whitelist when changing these page limits.
-- Fail rather than silently changing an unexpected/custom function definition.
do $$ declare signature text;definition text;begin
  foreach signature in array array['public.search_company_products(uuid,text,timestamp with time zone,uuid,text)',
    'public.read_public_catalog(text,text,timestamp with time zone,uuid,text)','public.search_catalog_share_products(uuid,text,timestamp with time zone,uuid)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if strpos(definition,'limit 51')=0 or strpos(definition,'limit 50')=0 or strpos(definition,'count(*)>50')=0 then raise exception 'Unexpected paging definition: %',signature;end if;
    execute replace(replace(replace(definition,'limit 51','limit 31'),'limit 50','limit 30'),'count(*)>50','count(*)>30');
  end loop;
end $$;
create index quotations_date_filter_idx on public.quotations(company_id,quote_date,created_by);

-- New overload: UI uses a compulsory inclusive 1-30 day interval. Old API retained.
create function public.search_company_quotations(target_company uuid,search_text text,filter_status text,in_trash boolean,after_updated timestamptz,after_id uuid,filter_creator uuid,filter_customer text,date_from date,date_to date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare member_role text;term text;result jsonb;
begin
  if not public.jomsales_company_enabled(target_company) then raise exception 'Company access denied.' using errcode='42501';end if;
  select role into member_role from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null;
  if member_role is null or (member_role<>'admin' and filter_creator is not null and filter_creator<>auth.uid()) then raise exception 'Company/employee access denied.' using errcode='42501';end if;
  if date_from is null or date_to is null or date_to<date_from or date_to-date_from>29 then raise exception 'Choose an inclusive interval of 1-30 days.' using errcode='22023';end if;
  if search_text is null or char_length(search_text)>240 or filter_status is null or filter_status not in('all','pending','success','paid') or in_trash is null or char_length(filter_customer)>120 or (after_updated is null)<>(after_id is null) then raise exception 'Invalid quotation search.' using errcode='22023';end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with page_rows as materialized(select id,number,quote_date,customer_name,created_by,creator_email,creator_name,status,confirmed_at,paid_at,total_amount,deleted_at,revision,updated_at from public.quotations
    where company_id=target_company and (case when in_trash then deleted_at is not null else deleted_at is null end)
      and quote_date between date_from and date_to and (filter_creator is null or created_by=filter_creator) and (filter_customer is null or btrim(customer_name)=btrim(filter_customer))
      and (filter_status='all' or status=filter_status) and lower(number||' '||customer_name||' '||coalesce(creator_name,'')||' '||coalesce(creator_email,'')) like term
      and (after_updated is null or updated_at<after_updated or (updated_at=after_updated and id>after_id)) order by updated_at desc,id limit 31),visible as(select * from page_rows order by updated_at desc,id limit 30)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by updated_at desc,id) from visible v),'[]'::jsonb),'has_more',(select count(*)>30 from page_rows),'cursor',(select jsonb_build_object('updated_at',updated_at,'id',id) from visible order by updated_at,id desc limit 1)) into result;return result;
end; $$;

-- Candidate names come from authorized historical snapshots, NOT all company contacts.
create function public.quotation_customer_options(target_company uuid,filter_creator uuid,option_search text,page_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member_role text;term text;result jsonb;
begin
  if not public.jomsales_company_enabled(target_company) then raise exception 'Company access denied.' using errcode='42501';end if;
  select role into member_role from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null;
  if member_role is null or (member_role<>'admin' and filter_creator is not null and filter_creator<>auth.uid()) then raise exception 'Company/employee access denied.' using errcode='42501';end if;
  if option_search is null or char_length(option_search)>120 or page_offset is null or page_offset<0 then raise exception 'Invalid customer option search.' using errcode='22023';end if;
  term:='%'||replace(replace(replace(lower(btrim(option_search)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with names as materialized(select distinct btrim(customer_name) name from public.quotations where company_id=target_company and (member_role='admin' or created_by=auth.uid()) and (filter_creator is null or created_by=filter_creator)
    and (deleted_at is null or deleted_at>statement_timestamp()-interval '15 days') and lower(btrim(customer_name)) like term),
    page as(select name from names order by name limit 31 offset page_offset),visible as(select name from page order by name limit 30)
  select jsonb_build_object('items',coalesce((select jsonb_agg(name order by name) from visible),'[]'::jsonb),'has_more',(select count(*)>30 from page)) into result;return result;
end; $$;

-- Extra owner argument; own-only editing RLS is NOT changed.
create function public.search_company_customers(target_company uuid,search_text text,include_inactive boolean,page_offset integer,filter_owner uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member_role text;term text;result jsonb;
begin
  if not public.jomsales_company_enabled(target_company) then raise exception 'Company access denied.' using errcode='42501';end if;
  select role into member_role from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null;
  if member_role is null or (member_role<>'admin' and filter_owner is not null and filter_owner<>auth.uid()) then raise exception 'Company/employee access denied.' using errcode='42501';end if;
  if search_text is null or char_length(search_text)>120 or page_offset is null or page_offset<0 or include_inactive is null then raise exception 'Invalid customer search.' using errcode='22023';end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with scoped as materialized(select c.id,c.company_id,c.created_by,c.name,c.company,c.phone,c.email,c.address,c.active,c.revision,c.created_at,coalesce(nullif(p.display_name,''),u.email::text,'姓名待补填') owner_name,coalesce(u.email::text,'') owner_email
    from public.customers c left join public.account_profiles p on p.user_id=c.created_by left join auth.users u on u.id=c.created_by
    where c.company_id=target_company and (member_role='admin' or c.created_by=auth.uid()) and (filter_owner is null or c.created_by=filter_owner) and (include_inactive or c.active)),
    visible as materialized(select * from scoped where lower(name||' '||company||' '||phone||' '||email||' '||owner_name||' '||owner_email) like term),page as(select * from visible order by created_at desc,id limit 50 offset page_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id) from page p),'[]'::jsonb),'total',(select count(*) from visible)) into result;return result;
end; $$;
revoke all on function public.search_company_quotations(uuid,text,text,boolean,timestamptz,uuid,uuid,text,date,date),public.quotation_customer_options(uuid,uuid,text,integer),public.search_company_customers(uuid,text,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function public.search_company_quotations(uuid,text,text,boolean,timestamptz,uuid,uuid,text,date,date),public.quotation_customer_options(uuid,uuid,text,integer),public.search_company_customers(uuid,text,boolean,integer,uuid) to authenticated;
commit;
