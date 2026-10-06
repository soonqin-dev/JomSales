-- Launchpad batch 5. Run once after 202610060004. No existing data rewritten.
begin;
create table public.product_price_jobs (
  company_id uuid not null references public.companies(id),
  job_id uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(company_id,job_id)
);
create table public.product_price_changes (
  company_id uuid not null,
  job_id uuid not null,
  row_number integer not null check(row_number between 1 and 10000),
  csv_line integer not null check(csv_line between 2 and 1000000),
  product_id uuid not null,
  serial text not null,
  product_name text not null,
  old_price numeric(9,2) not null,
  new_price numeric(9,2) not null,
  before_revision integer not null,
  after_revision integer not null,
  actor uuid not null references auth.users(id),
  actor_name text not null,
  actor_email text not null,
  payload_hash text not null,
  status text not null check(status in ('updated','unchanged')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(company_id,job_id,row_number),
  unique(company_id,job_id,product_id),
  foreign key(company_id,job_id) references public.product_price_jobs(company_id,job_id),
  check(old_price>=0 and new_price>=0)
);
create index product_price_changes_time_idx on public.product_price_changes(company_id,created_at desc);
alter table public.product_price_jobs enable row level security;
alter table public.product_price_changes enable row level security;
revoke all on public.product_price_jobs,public.product_price_changes from public,anon,authenticated;
grant select on public.product_price_jobs,public.product_price_changes to authenticated;
create policy price_jobs_admin_read on public.product_price_jobs for select to authenticated using(
  public.jomsales_company_enabled(company_id) and exists(select 1 from public.company_members m where m.company_id=product_price_jobs.company_id and m.user_id=auth.uid() and m.active and m.removed_at is null and m.role='admin'));
create policy price_changes_admin_read on public.product_price_changes for select to authenticated using(
  public.jomsales_company_enabled(company_id) and exists(select 1 from public.company_members m where m.company_id=product_price_changes.company_id and m.user_id=auth.uid() and m.active and m.removed_at is null and m.role='admin'));

-- Preview is read-only, limited to this company's live products, with exact price strings.
create function public.preview_product_prices(target_company uuid,codes text[]) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null and role='admin') then
    raise exception 'Administrator access required.' using errcode='42501'; end if;
  if codes is null or cardinality(codes) not between 1 and 500 or exists(select 1 from unnest(codes)c where c is null or char_length(btrim(c)) not between 1 and 120) then
    raise exception 'Preview requires 1-500 product codes.' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'serial',p.serial,'name',p.name,'price',p.price::text,'revision',p.revision,'unit',p.unit)),'[]'::jsonb) into result
    from public.products p where p.company_id=target_company and p.deleted_at is null and lower(btrim(p.serial))=any(array(select lower(btrim(c)) from unnest(codes)c));
  return result;
end; $$;

create function public.apply_product_prices(target_company uuid,request_job uuid,entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare entry jsonb; line integer; physical integer; target uuid; expected integer; before_price numeric; after_price numeric;
  hash text; previous public.product_price_changes; product public.products; owner uuid; result jsonb:='[]'::jsonb; change_status text; revision_after integer;
begin
  perform public.salesgo_require_admin(target_company);
  if request_job is null or jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 100 or char_length(entries::text)>100000 then
    raise exception 'Price update requires 1-100 rows.' using errcode='22023'; end if;
  insert into public.product_price_jobs(company_id,job_id,created_by) values(target_company,request_job,auth.uid()) on conflict do nothing;
  select created_by into owner from public.product_price_jobs where company_id=target_company and job_id=request_job;
  if owner is distinct from auth.uid() then raise exception 'This price job belongs to another administrator.' using errcode='42501'; end if;
  for entry in select value from jsonb_array_elements(entries) loop
    line:=null;
    begin
      if jsonb_typeof(entry) is distinct from 'object' or exists(select 1 from jsonb_object_keys(entry)k where k not in('row_number','csv_line','product_id','serial','expected_revision','old_price','new_price')) then
        raise exception 'Invalid price-only payload.' using errcode='22023'; end if;
      line:=(entry->>'row_number')::integer;physical:=(entry->>'csv_line')::integer;target:=(entry->>'product_id')::uuid;expected:=(entry->>'expected_revision')::integer;
      if line is null or line not between 1 and 10000 or physical is null or physical not between 2 and 1000000 or target is null or expected is null or expected<1
        or jsonb_typeof(entry->'serial') is distinct from 'string' or char_length(btrim(entry->>'serial')) not between 1 and 120
        or (entry->>'old_price') is null or (entry->>'old_price') !~ '^[0-9]+(\.[0-9]{1,2})?$'
        or (entry->>'new_price') is null or (entry->>'new_price') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
        raise exception 'Invalid code, price, revision or row number.' using errcode='22023'; end if;
      before_price:=(entry->>'old_price')::numeric;after_price:=(entry->>'new_price')::numeric;
      if before_price>9999999.99 or after_price>9999999.99 then raise exception 'Price exceeds allowed range.' using errcode='22023'; end if;
      hash:=encode(sha256(convert_to(entry::text,'UTF8')),'hex');
      select * into previous from public.product_price_changes where company_id=target_company and job_id=request_job and row_number=line;
      if found then
        if previous.payload_hash<>hash then raise exception 'Row changed after submission. Start a new preview.' using errcode='22023'; end if;
        result:=result||jsonb_build_array(jsonb_build_object('row_number',line,'status',previous.status,'product_id',previous.product_id,'old_price',previous.old_price::text,'new_price',previous.new_price::text,'revision',previous.after_revision,'replayed',true));
        continue;
      end if;
      if exists(select 1 from public.product_price_changes where company_id=target_company and job_id=request_job and product_id=target) then
        raise exception 'Product repeated in this job. Start a new preview.' using errcode='22023'; end if;
      select * into product from public.products where company_id=target_company and id=target and deleted_at is null and lower(btrim(serial))=lower(btrim(entry->>'serial')) for update;
      if not found then
        result:=result||jsonb_build_array(jsonb_build_object('row_number',line,'status','unavailable','message','产品已删除、编号已更改或不属于本公司，请重新预览。'));continue;
      end if;
      if product.revision<>expected or product.price<>before_price then
        result:=result||jsonb_build_array(jsonb_build_object('row_number',line,'status','conflict','message','产品在预览后已修改，未覆盖；请重新预览。'));continue;
      end if;
      change_status:='unchanged';revision_after:=product.revision;
      if product.price<>after_price then
        update public.products set price=after_price where company_id=target_company and id=target returning revision into revision_after;change_status:='updated';
      end if;
      insert into public.product_price_changes(company_id,job_id,row_number,csv_line,product_id,serial,product_name,old_price,new_price,before_revision,after_revision,actor,actor_name,actor_email,payload_hash,status)
        values(target_company,request_job,line,physical,target,product.serial,product.name,product.price,after_price,product.revision,revision_after,auth.uid(),
          coalesce((select display_name from public.account_profiles where user_id=auth.uid()),''),coalesce((select email::text from auth.users where id=auth.uid()),''),hash,change_status);
      result:=result||jsonb_build_array(jsonb_build_object('row_number',line,'status',change_status,'product_id',target,'old_price',product.price::text,'new_price',after_price::text,'revision',revision_after,'replayed',false));
    exception when data_exception or check_violation or unique_violation then
      -- A row-level savepoint rolls back both its price change and audit on failure.
      result:=result||jsonb_build_array(jsonb_build_object('row_number',line,'status','failed','message','调价内容无效或与已处理行冲突，请检查并重新预览。'));
    end;
  end loop;
  return result;
end; $$;
revoke all on function public.preview_product_prices(uuid,text[]),public.apply_product_prices(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.preview_product_prices(uuid,text[]),public.apply_product_prices(uuid,uuid,jsonb) to authenticated;
commit;
