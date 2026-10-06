-- Launchpad batch 2. Apply after 202610060001. No old products/quotes deleted.
begin;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
alter table public.products
  add column unit text not null default '件' check(char_length(btrim(unit)) between 1 and 30),
  add column category text not null default '' check(char_length(category)<=80),
  add column description text not null default '' check(char_length(description)<=2000),
  add column is_service boolean not null default false,
  add column thumbnail_path text,
  add column image_hash text check(image_hash is null or image_hash ~ '^[0-9a-f]{64}$');
alter table public.products add constraint products_thumbnail_check check(thumbnail_path is null or
  (thumbnail_path like company_id::text||'/'||id::text||'/%' and thumbnail_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'));
grant insert(unit,category,description,is_service,thumbnail_path,image_hash),update(unit,category,description,is_service,thumbnail_path,image_hash) on public.products to authenticated;
create function public.jomsales_search_document(serial text,name text,tags text[],category text,description text)
returns text language sql immutable set search_path='' as $$
  select lower(serial||' '||name||' '||array_to_string(tags,' ')||' '||category||' '||description)
$$;
revoke all on function public.jomsales_search_document(text,text,text[],text,text) from public,anon,authenticated;
-- Needed by the stored generated column on INSERT/UPDATE; does not expose rows.
grant execute on function public.jomsales_search_document(text,text,text[],text,text) to authenticated;
alter table public.products add column search_document text generated always as
  (public.jomsales_search_document(serial,name,tags,category,description)) stored;
-- pg_trgm might already live in public on an existing project. Locate its schema.
do $$ declare ns text; begin
  select n.nspname into ns from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
  execute format('create index products_search_trgm_idx on public.products using gin(search_document %I.gin_trgm_ops) where deleted_at is null',ns);
end; $$;

create function public.search_company_products(target_company uuid,search_text text default '',after_created timestamptz default null,after_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare term text; page jsonb; matched bigint;
begin
  if not exists(select 1 from public.company_members m where m.company_id=target_company and m.user_id=auth.uid() and m.active) then
    raise exception 'Company access denied.' using errcode='42501'; end if;
  if search_text is null or char_length(search_text)>240 or (after_created is null)<>(after_id is null) then
    raise exception 'Invalid search or cursor.' using errcode='22023'; end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  select count(*) into matched from public.products p where p.company_id=target_company and p.deleted_at is null and p.search_document like term;
  with page_rows as materialized (
    select p.id,p.company_id,p.serial,p.name,p.tags,p.price,p.image_path,p.thumbnail_path,p.image_hash,p.unit,p.category,p.description,p.is_service,p.source_key,p.revision,p.created_at
    from public.products p where p.company_id=target_company and p.deleted_at is null and p.search_document like term
      and (after_created is null or p.created_at<after_created or (p.created_at=after_created and p.id>after_id))
    order by p.created_at desc,p.id limit 51
  ), visible as (select * from page_rows order by created_at desc,id limit 50)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id) from visible v),'[]'::jsonb),
    'total',matched,'has_more',(select count(*)>50 from page_rows),
    'cursor',(select jsonb_build_object('created_at',v.created_at,'id',v.id) from visible v order by v.created_at,v.id desc limit 1)) into page;
  return page;
end; $$;

create table public.product_number_settings (
  company_id uuid primary key references public.companies(id),
  automatic boolean not null default true,
  prefix text not null default 'P-' check(char_length(prefix)<=30),
  digits integer not null default 5 check(digits between 1 and 12),
  next_number bigint not null default 1 check(next_number between 1 and 999999999999),
  revision integer not null default 1
);
create table public.product_number_reservations (
  product_id uuid primary key,
  company_id uuid not null references public.companies(id),
  serial text not null,
  created_at timestamptz not null default now()
);
create unique index product_number_reservations_serial_idx on public.product_number_reservations(company_id,lower(btrim(serial)));
alter table public.product_number_settings enable row level security;
alter table public.product_number_reservations enable row level security;
revoke all on public.product_number_settings,public.product_number_reservations from public,anon,authenticated;
insert into public.product_number_settings(company_id) select id from public.companies;
create function public.get_product_number_settings(target_company uuid) returns public.product_number_settings
language plpgsql security definer set search_path='' as $$
declare result public.product_number_settings;
begin
  perform public.salesgo_require_admin(target_company);
  insert into public.product_number_settings(company_id) values(target_company) on conflict do nothing;
  select * into result from public.product_number_settings where company_id=target_company;
  return result;
end; $$;
create function public.save_product_number_settings(target_company uuid,expected_revision integer,auto_number boolean,number_prefix text,number_digits integer,next_value bigint)
returns public.product_number_settings language plpgsql security definer set search_path='' as $$
declare result public.product_number_settings;
begin
  perform public.salesgo_require_admin(target_company);
  if number_prefix is null or auto_number is null or number_digits is null or next_value is null then raise exception 'Number settings required.' using errcode='22023'; end if;
  update public.product_number_settings set automatic=auto_number,prefix=btrim(number_prefix),digits=number_digits,next_number=next_value,revision=revision+1
    where company_id=target_company and revision=expected_revision returning * into result;
  if not found then raise exception 'Number settings changed. Reload first.' using errcode='40001'; end if;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'products.number_settings',jsonb_build_object('automatic',auto_number,'prefix',number_prefix,'digits',number_digits,'next_number',next_value));
  return result;
end; $$;
create function public.reserve_product_number(target_company uuid,target_product uuid) returns text
language plpgsql security definer set search_path='' as $$
declare settings public.product_number_settings; result text; attempted integer:=0;
begin
  perform 1 from public.companies where id=target_company for update;
  if target_product is null or not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members m
    where m.company_id=target_company and m.user_id=auth.uid() and m.active and m.removed_at is null and (m.role='admin' or m.can_manage_products)) then
    raise exception 'Product management permission required.' using errcode='42501'; end if;
  select serial into result from public.product_number_reservations where product_id=target_product and company_id=target_company;
  if found then return result; end if;
  if exists(select 1 from public.product_number_reservations where product_id=target_product) or exists(select 1 from public.products where id=target_product) then
    raise exception 'Product identity already used.' using errcode='22023'; end if;
  insert into public.product_number_settings(company_id) values(target_company) on conflict do nothing;
  select * into settings from public.product_number_settings where company_id=target_company for update;
  if not settings.automatic then raise exception 'Automatic numbering disabled. Enter a product code.' using errcode='22023'; end if;
  loop
    result:=settings.prefix||lpad(settings.next_number::text,greatest(settings.digits,char_length(settings.next_number::text)),'0');
    exit when not exists(select 1 from public.products where company_id=target_company and lower(btrim(serial))=lower(result))
      and not exists(select 1 from public.product_number_reservations where company_id=target_company and lower(serial)=lower(result));
    attempted:=attempted+1; settings.next_number:=settings.next_number+1;
    if attempted>=10000 then raise exception 'Too many existing codes. Increase the next number in company settings.' using errcode='22023'; end if;
  end loop;
  insert into public.product_number_reservations(product_id,company_id,serial) values(target_product,target_company,result);
  update public.product_number_settings set next_number=settings.next_number+1,revision=revision+1 where company_id=target_company;
  return result;
end; $$;

-- Enforce product cap on direct API inserts too, not only CSV. Edits and
-- downgrade do not delete existing products. Serialize with imports/numbering.
create function public.jomsales_guard_product_insert() returns trigger
language plpgsql security definer set search_path='' as $$
declare cap integer;
begin
  perform 1 from public.companies where id=new.company_id for update;
  if auth.uid() is not null and (not public.jomsales_company_enabled(new.company_id) or not exists(select 1 from public.company_members
    where company_id=new.company_id and user_id=auth.uid() and active and removed_at is null and (role='admin' or can_manage_products))) then
    raise exception 'Product management permission required.' using errcode='42501'; end if;
  if exists(select 1 from public.product_number_reservations r where r.company_id=new.company_id and lower(r.serial)=lower(btrim(new.serial)) and r.product_id<>new.id) then
    raise exception 'Product code reserved by another pending product.' using errcode='23505'; end if;
  select product_limit into cap from public.company_entitlements where company_id=new.company_id;
  if tg_op='INSERT' and cap is not null and (select count(*) from public.products where company_id=new.company_id and deleted_at is null)>=cap then
    raise exception 'Company product quota reached.' using errcode='22023'; end if;
  return new;
end; $$;
revoke all on function public.jomsales_guard_product_insert() from public,anon,authenticated;
create trigger jomsales_guard_product_insert before insert on public.products for each row execute function public.jomsales_guard_product_insert();
create trigger jomsales_guard_product_code before update of serial on public.products for each row execute function public.jomsales_guard_product_insert();
-- Protect thumbnails just like originals; never remove a referenced object.
alter policy salesgo_admins_remove_unused_images on storage.objects using(bucket_id='salesgo-products' and exists(select 1 from public.company_members m
  where m.company_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()) and m.active and (m.role='admin' or m.can_manage_products))
  and not exists(select 1 from public.products p where (p.image_path=storage.objects.name or p.thumbnail_path=storage.objects.name) and p.deleted_at is null));

create table public.product_import_rows (
  company_id uuid not null references public.companies(id),
  import_id uuid not null,
  row_number integer not null check(row_number between 1 and 10000),
  payload_hash text not null,
  product_id uuid not null references public.products(id),
  created_at timestamptz not null default now(),
  primary key(company_id,import_id,row_number)
);
alter table public.product_import_rows enable row level security;
revoke all on public.product_import_rows from public,anon,authenticated;
create function public.import_products_batch(target_company uuid,import_key uuid,entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare entry jsonb; result jsonb:='[]'; line integer; hash text; previous public.product_import_rows; created uuid; problem text;
begin
  perform public.salesgo_require_admin(target_company);
  if import_key is null or jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 100 then
    raise exception 'Import requires 1-100 rows per request.' using errcode='22023'; end if;
  for entry in select value from jsonb_array_elements(entries) loop
    line:=null;
    begin
      line:=(entry->>'row_number')::integer;
      if line is null or line not between 1 and 10000 then raise exception 'Invalid row number.' using errcode='22023'; end if;
      hash:=encode(sha256(convert_to(entry::text,'UTF8')),'hex');
      select * into previous from public.product_import_rows where company_id=target_company and import_id=import_key and row_number=line;
      if found then
        if previous.payload_hash<>hash then raise exception 'Row changed after import. Start a new preview.' using errcode='22023'; end if;
        result:=result||jsonb_build_array(jsonb_build_object('row_number',line,'status','imported','product_id',previous.product_id,'replayed',true));
        continue;
      end if;
      if jsonb_typeof(entry->'serial') is distinct from 'string' or char_length(btrim(entry->>'serial')) not between 1 and 120
        or jsonb_typeof(entry->'name') is distinct from 'string' or char_length(btrim(entry->>'name')) not between 1 and 240
        or (entry->>'price') is null or (entry->>'price') !~ '^[0-9]+(\.[0-9]{1,2})?$'
        or coalesce(jsonb_typeof(entry->'tags'),'array')<>'array'
        or (entry ? 'unit' and (jsonb_typeof(entry->'unit')<>'string' or char_length(entry->>'unit')>30))
        or (entry ? 'category' and (jsonb_typeof(entry->'category')<>'string' or char_length(entry->>'category')>80))
        or (entry ? 'description' and (jsonb_typeof(entry->'description')<>'string' or char_length(entry->>'description')>2000))
        or (entry ? 'is_service' and jsonb_typeof(entry->'is_service')<>'boolean') then
        raise exception 'Invalid name, code, price, tags or service flag.' using errcode='22023'; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(entry->'tags','[]')) v(value) where jsonb_typeof(v.value)<>'string') then raise exception 'Tags must be text.' using errcode='22023'; end if;
      if jsonb_array_length(coalesce(entry->'tags','[]'))>20 or char_length(array_to_string(array(select jsonb_array_elements_text(coalesce(entry->'tags','[]'))),','))>2000 then
        raise exception 'Too many or oversized tags.' using errcode='22023'; end if;
      if exists(select 1 from public.products p where p.company_id=target_company and p.deleted_at is null and lower(btrim(p.serial))=lower(btrim(entry->>'serial'))) then
        result:=result||jsonb_build_array(jsonb_build_object('row_number',line,'status','duplicate','message','Code already exists; not overwritten.')); continue;
      end if;
      created:=gen_random_uuid();
      insert into public.products(id,company_id,serial,name,price,tags,unit,category,description,is_service,created_by)
        values(created,target_company,btrim(entry->>'serial'),btrim(entry->>'name'),(entry->>'price')::numeric,
          array(select jsonb_array_elements_text(coalesce(entry->'tags','[]'))),coalesce(nullif(btrim(entry->>'unit'),''),'件'),
          coalesce(entry->>'category',''),coalesce(entry->>'description',''),coalesce((entry->>'is_service')::boolean,false),auth.uid());
      insert into public.product_import_rows(company_id,import_id,row_number,payload_hash,product_id) values(target_company,import_key,line,hash,created);
      result:=result||jsonb_build_array(jsonb_build_object('row_number',line,'status','imported','product_id',created,'replayed',false));
    exception when data_exception or check_violation or unique_violation then
      get stacked diagnostics problem=message_text;
      result:=result||jsonb_build_array(jsonb_build_object('row_number',line,'status','failed','message',problem));
    end;
  end loop;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'products.import_batch',jsonb_build_object('import_id',import_key,'rows',jsonb_array_length(entries)));
  return result;
end; $$;

create function public.check_product_import_codes(target_company uuid,codes text[]) returns text[]
language plpgsql stable security invoker set search_path='' as $$
declare result text[];
begin
  if not exists(select 1 from public.company_members where company_id=target_company and user_id=auth.uid() and active and role='admin') then
    raise exception 'Administrator access required.' using errcode='42501'; end if;
  if codes is null or cardinality(codes)>500 then raise exception 'At most 500 codes per check.' using errcode='22023'; end if;
  select coalesce(array_agg(lower(btrim(p.serial))),'{}'::text[]) into result from public.products p
    where p.company_id=target_company and p.deleted_at is null and lower(btrim(p.serial))=any(array(select lower(btrim(v)) from unnest(codes) v));
  return result;
end; $$;

-- Exact line-level cents, round half up, quantity precision up to 3 decimals.
-- Integer-only old quotation snapshots still validate without modification.
create or replace function public.quote_subtotal_cents(lines jsonb) returns numeric
language plpgsql immutable set search_path='' as $$
declare line jsonb; quantity numeric; unit_price numeric; total numeric:=0;
begin
  if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines)>200 then raise exception 'Quotation requires at most 200 lines.' using errcode='22023'; end if;
  for line in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(line->'product') is distinct from 'object' or jsonb_typeof(line->'product'->'id') is distinct from 'string'
      or char_length(line->'product'->>'id') not between 1 and 240 or jsonb_typeof(line->'product'->'serial') is distinct from 'string'
      or char_length(btrim(line->'product'->>'serial')) not between 1 and 120 or jsonb_typeof(line->'product'->'name') is distinct from 'string'
      or char_length(btrim(line->'product'->>'name')) not between 1 and 240 or jsonb_typeof(line->'quantity') is distinct from 'number'
      or jsonb_typeof(line->'unitPrice') is distinct from 'number' then raise exception 'Invalid quotation snapshot.' using errcode='22023'; end if;
    if (line->'product' ? 'unit' and (jsonb_typeof(line->'product'->'unit')<>'string' or char_length(btrim(line->'product'->>'unit')) not between 1 and 30))
      or (line->'product' ? 'description' and (jsonb_typeof(line->'product'->'description')<>'string' or char_length(line->'product'->>'description')>2000))
      or (line->'product' ? 'is_service' and jsonb_typeof(line->'product'->'is_service')<>'boolean') then raise exception 'Invalid unit or description snapshot.' using errcode='22023'; end if;
    quantity:=(line->>'quantity')::numeric; unit_price:=(line->>'unitPrice')::numeric;
    if quantity<=0 or quantity>999999 or quantity*1000<>trunc(quantity*1000) or unit_price<0 or unit_price>9999999.99 or unit_price*100<>trunc(unit_price*100) then
      raise exception 'Invalid quotation quantity or price.' using errcode='22023'; end if;
    total:=total+round(quantity*unit_price*100);
    if total>9007199254740991 then raise exception 'Quotation total exceeds safe range.' using errcode='22023'; end if;
  end loop;
  return total;
end; $$;

revoke all on function public.search_company_products(uuid,text,timestamptz,uuid),public.get_product_number_settings(uuid),
  public.save_product_number_settings(uuid,integer,boolean,text,integer,bigint),public.reserve_product_number(uuid,uuid),
  public.import_products_batch(uuid,uuid,jsonb),public.check_product_import_codes(uuid,text[]) from public,anon,authenticated;
grant execute on function public.search_company_products(uuid,text,timestamptz,uuid),public.get_product_number_settings(uuid),
  public.save_product_number_settings(uuid,integer,boolean,text,integer,bigint),public.reserve_product_number(uuid,uuid),
  public.import_products_batch(uuid,uuid,jsonb),public.check_product_import_codes(uuid,text[]) to authenticated;
commit;
