-- Run ONCE as postgres AFTER all four earlier migrations. Existing products,
-- members, users and browser backups are preserved. No physical files deleted.
begin;
alter table public.companies add column contact text not null default '' check(char_length(contact)<=180),
  add column logo_path text,
  add column brand_revision integer not null default 1;
alter table public.companies add constraint companies_logo_path_check check(logo_path is null or
  (logo_path like id::text||'/%' and logo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'));

create function public.quote_subtotal_cents(lines jsonb) returns numeric
language plpgsql immutable set search_path='' as $$
declare line jsonb; quantity numeric; unit_price numeric; total numeric:=0;
begin
  if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines)>200 then
    raise exception 'Quotation requires an array with at most 200 lines.' using errcode='22023';
  end if;
  for line in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(line->'product') is distinct from 'object'
      or jsonb_typeof(line->'product'->'id') is distinct from 'string'
      or char_length(line->'product'->>'id') not between 1 and 240
      or jsonb_typeof(line->'product'->'serial') is distinct from 'string'
      or char_length(btrim(line->'product'->>'serial')) not between 1 and 120
      or jsonb_typeof(line->'product'->'name') is distinct from 'string'
      or char_length(btrim(line->'product'->>'name')) not between 1 and 240
      or jsonb_typeof(line->'quantity') is distinct from 'number'
      or jsonb_typeof(line->'unitPrice') is distinct from 'number' then
      raise exception 'Invalid quotation line snapshot.' using errcode='22023';
    end if;
    quantity:=(line->>'quantity')::numeric; unit_price:=(line->>'unitPrice')::numeric;
    if quantity<1 or quantity>999999 or quantity<>trunc(quantity)
      or unit_price<0 or unit_price>9999999.99 or unit_price*100<>trunc(unit_price*100) then
      raise exception 'Invalid quotation quantity or price.' using errcode='22023';
    end if;
    total:=total+quantity*unit_price*100;
    if total>9007199254740991 then raise exception 'Quotation total exceeds safe range.' using errcode='22023'; end if;
  end loop;
  return total;
end;
$$;
revoke all on function public.quote_subtotal_cents(jsonb) from public,anon,authenticated;
grant execute on function public.quote_subtotal_cents(jsonb) to authenticated;

create table public.quotations(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  number text not null check(char_length(btrim(number)) between 1 and 120),
  quote_date date not null,
  customer_name text not null default '' check(char_length(customer_name)<=120),
  customer_phone text not null default '' check(char_length(customer_phone)<=40),
  notes text not null default '' check(char_length(notes)<=3000),
  discount numeric(16,2) not null default 0 check(discount>=0),
  items jsonb not null default '[]',
  company_snapshot jsonb not null default '{}',
  source_key text check(source_key is null or char_length(source_key) between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique(company_id,created_by,source_key),
  check(discount*100<=public.quote_subtotal_cents(items))
);
create index quotations_company_updated_idx on public.quotations(company_id,updated_at desc,id);
create index quotations_owner_idx on public.quotations(company_id,created_by,updated_at desc);
create function public.stamp_quotation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    select jsonb_build_object('name',c.name,'contact',c.contact,'logo_path',c.logo_path)
      into new.company_snapshot from public.companies c where c.id=new.company_id;
  else
    new.revision:=old.revision+1;
    new.updated_at:=clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_quotation() from public,anon,authenticated;
create trigger stamp_quotation before insert or update on public.quotations
for each row execute function public.stamp_quotation();
alter table public.quotations enable row level security;
revoke all on public.quotations from public,anon,authenticated;
grant select on public.quotations to authenticated;
grant insert(id,company_id,number,quote_date,customer_name,customer_phone,notes,discount,items,source_key) on public.quotations to authenticated;
grant update(number,quote_date,customer_name,customer_phone,notes,discount,items) on public.quotations to authenticated;
create policy members_read_scoped_quotes on public.quotations for select to authenticated
using(exists(select 1 from public.company_members m where m.company_id=quotations.company_id
  and m.user_id=(select auth.uid()) and m.active and (m.role='admin' or quotations.created_by=(select auth.uid()))));
create policy members_insert_own_quotes on public.quotations for insert to authenticated
with check(created_by=(select auth.uid()) and exists(select 1 from public.company_members m
  where m.company_id=quotations.company_id and m.user_id=(select auth.uid()) and m.active
  and (quotations.source_key is null or m.role='admin')));
create policy members_update_scoped_quotes on public.quotations for update to authenticated
using(exists(select 1 from public.company_members m where m.company_id=quotations.company_id
  and m.user_id=(select auth.uid()) and m.active and (m.role='admin' or quotations.created_by=(select auth.uid()))))
with check(exists(select 1 from public.company_members m where m.company_id=quotations.company_id
  and m.user_id=(select auth.uid()) and m.active and (m.role='admin' or quotations.created_by=(select auth.uid()))));

create function public.save_company_brand(target_company uuid,company_name text,company_contact text,new_logo_path text,expected_revision integer)
returns public.companies language plpgsql security definer set search_path='' as $$
declare result public.companies;
begin
  perform public.salesgo_require_admin(target_company);
  if company_name is null or char_length(btrim(company_name)) not between 1 and 120
    or company_contact is null or char_length(company_contact)>180 then
    raise exception 'Invalid company branding fields.' using errcode='22023';
  end if;
  update public.companies c set name=btrim(company_name),contact=company_contact,logo_path=new_logo_path,brand_revision=c.brand_revision+1
    where c.id=target_company and c.brand_revision=expected_revision returning * into result;
  if not found then raise exception 'Company branding changed. Reload before saving.' using errcode='40001'; end if;
  return result;
end;
$$;
revoke all on function public.save_company_brand(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.save_company_brand(uuid,text,text,text,integer) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('salesgo-branding','salesgo-branding',false,1048576,array['image/webp','image/jpeg','image/png']);
create policy salesgo_members_read_branding on storage.objects for select to authenticated
using(bucket_id='salesgo-branding' and exists(select 1 from public.company_members m
  where m.company_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()) and m.active));
create policy salesgo_admins_upload_branding on storage.objects for insert to authenticated
with check(bucket_id='salesgo-branding' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'
  and exists(select 1 from public.company_members m where m.company_id::text=(storage.foldername(name))[1]
    and m.user_id=(select auth.uid()) and m.active and m.role='admin'));
create policy salesgo_admins_clean_unused_branding on storage.objects for delete to authenticated
using(bucket_id='salesgo-branding' and exists(select 1 from public.company_members m
  where m.company_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()) and m.active and m.role='admin')
  and not exists(select 1 from public.companies c where c.logo_path=storage.objects.name)
  and not exists(select 1 from public.quotations q where q.company_snapshot->>'logo_path'=storage.objects.name));
commit;
select tablename,rowsecurity as row_security_enabled from pg_tables
where schemaname='public' and tablename='quotations';
select id,public,file_size_limit from storage.buckets where id='salesgo-branding';
