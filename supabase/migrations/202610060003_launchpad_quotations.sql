-- Launchpad batch 3. Apply after 202610060002. No old quotes or customers deleted.
begin;
create table public.quotation_defaults (
  company_id uuid primary key references public.companies(id),
  prefix text not null default 'Q' check(char_length(btrim(prefix)) between 1 and 30),
  digits integer not null default 5 check(digits between 1 and 12),
  validity_days integer not null default 14 check(validity_days between 1 and 365),
  payment_terms text not null default '' check(char_length(payment_terms)<=1500),
  notes text not null default '' check(char_length(notes)<=3000),
  revision integer not null default 1
);
insert into public.quotation_defaults(company_id) select id from public.companies;
create table public.quotation_sequences (
  company_id uuid not null references public.companies(id),quote_year integer not null,
  last_number bigint not null default 0 check(last_number between 0 and 999999999999),
  primary key(company_id,quote_year)
);
create table public.quotation_number_reservations (
  quote_id uuid primary key,company_id uuid not null references public.companies(id),number text not null
);
create unique index quotation_number_reserved_unique on public.quotation_number_reservations(company_id,lower(btrim(number)));
alter table public.quotation_defaults enable row level security;
alter table public.quotation_sequences enable row level security;
alter table public.quotation_number_reservations enable row level security;
revoke all on public.quotation_defaults,public.quotation_sequences,public.quotation_number_reservations from public,anon,authenticated;
grant select on public.quotation_defaults to authenticated;
create policy defaults_read_member on public.quotation_defaults for select to authenticated using(exists(select 1 from public.company_members m where m.company_id=quotation_defaults.company_id and m.user_id=(select auth.uid()) and m.active));

create function public.get_quotation_defaults(target_company uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.company_members where company_id=target_company and user_id=auth.uid() and active) then raise exception 'Company access denied.' using errcode='42501'; end if;
  select to_jsonb(d) into result from public.quotation_defaults d where d.company_id=target_company;
  return coalesce(result,jsonb_build_object('company_id',target_company,'prefix','Q','digits',5,'validity_days',14,'payment_terms','','notes','','revision',0));
end; $$;
create function public.save_quotation_defaults(target_company uuid,expected_revision integer,number_prefix text,number_digits integer,valid_days integer,payment_text text,default_notes text)
returns public.quotation_defaults language plpgsql security definer set search_path='' as $$
declare result public.quotation_defaults;
begin
  perform public.salesgo_require_admin(target_company);
  if number_prefix is null or number_digits is null or valid_days is null or payment_text is null or default_notes is null then raise exception 'Default fields required.' using errcode='22023'; end if;
  select * into result from public.quotation_defaults where company_id=target_company;
  if not found and expected_revision=0 then
    insert into public.quotation_defaults(company_id,prefix,digits,validity_days,payment_terms,notes)
      values(target_company,btrim(number_prefix),number_digits,valid_days,payment_text,default_notes) returning * into result;
  else
    update public.quotation_defaults set prefix=btrim(number_prefix),digits=number_digits,validity_days=valid_days,payment_terms=payment_text,notes=default_notes,revision=revision+1
      where company_id=target_company and revision=expected_revision returning * into result;
    if not found then raise exception 'Quotation settings changed. Reload first.' using errcode='40001'; end if;
  end if;
  insert into public.platform_audit(actor,company_id,action,details) values(auth.uid(),target_company,'quotations.defaults',jsonb_build_object('revision',result.revision));
  return result;
end; $$;

create table public.customers (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  name text not null check(char_length(btrim(name)) between 1 and 120),
  company text not null default '' check(char_length(company)<=120),
  phone text not null default '' check(char_length(phone)<=40),
  email text not null default '' check(char_length(email)<=254 and (email='' or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  address text not null default '' check(char_length(address)<=1000),
  active boolean not null default true,revision integer not null default 1,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index customers_owner_idx on public.customers(company_id,created_by,created_at desc,id);
alter table public.customers enable row level security;
revoke all on public.customers from public,anon,authenticated;
grant select on public.customers to authenticated;
grant insert(id,company_id,name,company,phone,email,address) on public.customers to authenticated;
grant update(name,company,phone,email,address,active) on public.customers to authenticated;
create policy customers_read_scoped on public.customers for select to authenticated using(exists(select 1 from public.company_members m
  where m.company_id=customers.company_id and m.user_id=(select auth.uid()) and m.active and (m.role='admin' or customers.created_by=(select auth.uid()))));
create policy customers_insert_own on public.customers for insert to authenticated with check(created_by=(select auth.uid()) and exists(select 1 from public.company_members m where m.company_id=customers.company_id and m.user_id=(select auth.uid()) and m.active));
create policy customers_update_own on public.customers for update to authenticated using(created_by=(select auth.uid()) and exists(select 1 from public.company_members m where m.company_id=customers.company_id and m.user_id=(select auth.uid()) and m.active))
  with check(created_by=(select auth.uid()) and exists(select 1 from public.company_members m where m.company_id=customers.company_id and m.user_id=(select auth.uid()) and m.active));
create function public.stamp_customer() returns trigger language plpgsql set search_path='' as $$
begin new.revision:=old.revision+1;new.updated_at:=clock_timestamp();return new;end; $$;
revoke all on function public.stamp_customer() from public,anon,authenticated;
create trigger stamp_customer before update on public.customers for each row execute function public.stamp_customer();
create function public.search_company_customers(target_company uuid,search_text text default '',include_inactive boolean default false,page_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare term text; result jsonb;
begin
  if not exists(select 1 from public.company_members where company_id=target_company and user_id=auth.uid() and active) then raise exception 'Company access denied.' using errcode='42501'; end if;
  if search_text is null or char_length(search_text)>120 or page_offset is null or page_offset<0 or include_inactive is null then raise exception 'Invalid customer search.' using errcode='22023'; end if;
  term:='%'||replace(replace(replace(lower(btrim(search_text)),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
  with visible as materialized(select * from public.customers c where c.company_id=target_company and (include_inactive or c.active)
    and lower(c.name||' '||c.company||' '||c.phone||' '||c.email) like term), page as(select * from visible order by created_at desc,id limit 50 offset page_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from page p),'[]'::jsonb),'total',(select count(*) from visible)) into result;
  return result;
end; $$;

alter table public.quotations drop constraint quotations_status_check;
alter table public.quotations add constraint quotations_status_check check(status in ('pending','success','paid'));
alter table public.quotations add column customer_id uuid references public.customers(id),
  add column customer_company text not null default '' check(char_length(customer_company)<=120),
  add column customer_email text not null default '' check(char_length(customer_email)<=254),
  add column customer_address text not null default '' check(char_length(customer_address)<=1000),
  add column validity_days integer check(validity_days between 1 and 365),
  add column payment_terms text not null default '' check(char_length(payment_terms)<=1500),
  add column confirmed_at timestamptz,add column paid_at timestamptz,
  add column request_hash text,
  add column total_amount numeric(16,2) generated always as (public.quote_subtotal_cents(items)/100-discount) stored;
grant insert(customer_id,customer_company,customer_email,customer_address,validity_days,payment_terms),update(customer_id,customer_company,customer_email,customer_address,validity_days,payment_terms) on public.quotations to authenticated;
alter table public.quotations add constraint quotations_customer_email_format_check check(customer_email='' or customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

create or replace function public.stamp_quotation() returns trigger
language plpgsql security definer set search_path='' as $$
declare settings public.quotation_defaults; next_value bigint; year_value integer; assigned text; attempts integer:=0; member_role text;
begin
  if auth.uid() is not null then
    if not public.jomsales_company_enabled(new.company_id) then raise exception 'Company access denied.' using errcode='42501'; end if;
    select role into member_role from public.company_members where company_id=new.company_id and user_id=auth.uid() and active and removed_at is null;
    if member_role is null then raise exception 'Company access denied.' using errcode='42501'; end if;
    if new.customer_id is not null and (tg_op='INSERT' or new.customer_id is distinct from old.customer_id) and not exists(select 1 from public.customers c
      where c.id=new.customer_id and c.company_id=new.company_id and c.active and (c.created_by=auth.uid() or member_role='admin')) then raise exception 'Customer access denied.' using errcode='42501'; end if;
  end if;
  if tg_op='INSERT' then
    if (auth.uid() is not null and new.source_key is null) or new.number is null then
      perform 1 from public.companies where id=new.company_id for update;
      select number into assigned from public.quotation_number_reservations where quote_id=new.id and company_id=new.company_id;
      if not found then
        if exists(select 1 from public.quotation_number_reservations where quote_id=new.id) then raise exception 'Quotation identity already used.' using errcode='22023'; end if;
        insert into public.quotation_defaults(company_id) values(new.company_id) on conflict do nothing;
        select * into settings from public.quotation_defaults where company_id=new.company_id;
        year_value:=extract(year from new.quote_date)::integer;
        insert into public.quotation_sequences(company_id,quote_year) values(new.company_id,year_value) on conflict do nothing;
        select last_number+1 into next_value from public.quotation_sequences where company_id=new.company_id and quote_year=year_value for update;
        loop
          assigned:=settings.prefix||'-'||year_value::text||'-'||lpad(next_value::text,greatest(settings.digits,char_length(next_value::text)),'0');
          exit when not exists(select 1 from public.quotations where company_id=new.company_id and lower(btrim(number))=lower(assigned))
            and not exists(select 1 from public.quotation_number_reservations where company_id=new.company_id and lower(btrim(number))=lower(assigned));
          attempts:=attempts+1;next_value:=next_value+1;
          if attempts>=10000 then raise exception 'Number collision limit reached.' using errcode='22023'; end if;
        end loop;
        update public.quotation_sequences set last_number=next_value where company_id=new.company_id and quote_year=year_value;
        insert into public.quotation_number_reservations(quote_id,company_id,number) values(new.id,new.company_id,assigned);
      end if;
      new.number:=assigned;
    end if;
    select jsonb_build_object('name',c.name,'contact',c.contact,'logo_path',c.logo_path) into new.company_snapshot from public.companies c where c.id=new.company_id;
    select coalesce(u.email,'') into new.creator_email from auth.users u where u.id=new.created_by;
    new.creator_name:=coalesce((select display_name from public.account_profiles where user_id=new.created_by),'');
  else
    new.number:=old.number;new.company_snapshot:=old.company_snapshot;new.creator_name:=old.creator_name;new.creator_email:=old.creator_email;
    new.confirmed_at:=old.confirmed_at;new.paid_at:=old.paid_at;new.request_hash:=old.request_hash;
    if new.status is distinct from old.status then
      if new.status='pending' then new.confirmed_at:=null;new.paid_at:=null;
      elsif new.status='success' then new.confirmed_at:=case when old.status='pending' then clock_timestamp() else old.confirmed_at end;new.paid_at:=null;
      elsif new.status='paid' then new.confirmed_at:=case when old.status='pending' then clock_timestamp() else old.confirmed_at end;new.paid_at:=clock_timestamp();end if;
    end if;
    new.revision:=old.revision+1;new.updated_at:=clock_timestamp();
  end if;
  return new;
end; $$;

create function public.create_quotation(target_company uuid,target_quote uuid,payload jsonb) returns public.quotations
language plpgsql security definer set search_path='' as $$
declare result public.quotations; hash text;
begin
  perform 1 from public.companies where id=target_company for update;
  if not public.jomsales_company_enabled(target_company) or not exists(select 1 from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null) then raise exception 'Company access denied.' using errcode='42501'; end if;
  if target_quote is null or jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(payload->'items') is distinct from 'array'
    or jsonb_array_length(payload->'items') not between 1 and 200 or nullif(btrim(payload->>'customer_name'),'') is null then raise exception 'Quotation requires customer and valid items.' using errcode='22023'; end if;
  hash:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  select * into result from public.quotations where id=target_quote;
  if found then
    if result.company_id=target_company and result.created_by=auth.uid() and result.request_hash=hash and result.revision=1 and result.deleted_at is null then return result;end if;
    raise exception 'Quotation request changed or already used. Check saved record.' using errcode='40001';
  end if;
  insert into public.quotations(id,company_id,created_by,number,quote_date,customer_name,customer_phone,customer_company,customer_email,customer_address,customer_id,notes,discount,items,validity_days,payment_terms,request_hash)
    values(target_quote,target_company,auth.uid(),null,(payload->>'quote_date')::date,payload->>'customer_name',coalesce(payload->>'customer_phone',''),
      coalesce(payload->>'customer_company',''),coalesce(payload->>'customer_email',''),coalesce(payload->>'customer_address',''),nullif(payload->>'customer_id','')::uuid,
      coalesce(payload->>'notes',''),coalesce((payload->>'discount')::numeric,0),payload->'items',(payload->>'validity_days')::integer,coalesce(payload->>'payment_terms',''),hash)
      returning * into result;
  return result;
end; $$;

create table public.quotation_events (
  id uuid primary key default gen_random_uuid(),quote_id uuid not null references public.quotations(id) on delete cascade,
  company_id uuid not null references public.companies(id),actor uuid references auth.users(id),
  action text not null,details jsonb not null,created_at timestamptz not null default clock_timestamp()
);
alter table public.quotation_events enable row level security;
revoke all on public.quotation_events from public,anon,authenticated;
grant select on public.quotation_events to authenticated;
create index quotation_events_quote_idx on public.quotation_events(quote_id,created_at desc);
create policy events_read_scoped on public.quotation_events for select to authenticated using(exists(select 1 from public.quotations q where q.id=quotation_events.quote_id and q.company_id=quotation_events.company_id));
create function public.record_quotation_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare event_action text;
begin
  if tg_op='INSERT' then event_action:='created';
  elsif new.deleted_at is distinct from old.deleted_at then event_action:=case when new.deleted_at is null then 'restored' else 'trashed' end;
  elsif new.status is distinct from old.status then event_action:='status';
  elsif (to_jsonb(new)-array['revision','updated_at']) is distinct from (to_jsonb(old)-array['revision','updated_at']) then event_action:='edited';
  else return new;end if;
  insert into public.quotation_events(quote_id,company_id,actor,action,details) values(new.id,new.company_id,auth.uid(),event_action,
    jsonb_build_object('status',new.status,'previous_status',case when tg_op='UPDATE' then old.status else null end,'total',new.total_amount::text,'number',new.number,'revision',new.revision,
      'actor_name',coalesce((select display_name from public.account_profiles where user_id=auth.uid()),''),'actor_email',coalesce((select email::text from auth.users where id=auth.uid()),'')));
  return new;
end; $$;
revoke all on function public.record_quotation_event() from public,anon,authenticated;
create trigger record_quotation_event after insert or update on public.quotations for each row execute function public.record_quotation_event();
create index quotations_confirmed_idx on public.quotations(company_id,confirmed_at,created_by) where deleted_at is null;
create index quotations_paid_idx on public.quotations(company_id,paid_at,created_by) where deleted_at is null;
create or replace function public.manage_quotation(target_company uuid,target_quote uuid,expected_revision integer,action text)
returns public.quotations language plpgsql security definer set search_path='' as $$
declare result public.quotations; member_role text;
begin
  perform 1 from public.companies where id=target_company for share;
  if not public.jomsales_company_enabled(target_company) then raise exception 'Company access denied.' using errcode='42501';end if;
  select role into member_role from public.company_members where company_id=target_company and user_id=auth.uid() and active and removed_at is null for share;
  select * into result from public.quotations where id=target_quote and company_id=target_company for update;
  if member_role is null or not found or (member_role<>'admin' and result.created_by<>auth.uid()) then raise exception 'Quotation access denied.' using errcode='42501';end if;
  if result.revision is distinct from expected_revision then raise exception 'Quotation changed. Refresh before retrying.' using errcode='40001';end if;
  if action='restore' then
    if result.deleted_at is null or result.deleted_at<=clock_timestamp()-interval '15 days' then raise exception 'Quotation not recoverable.' using errcode='22023';end if;
    update public.quotations set deleted_at=null where id=target_quote returning * into result;
  elsif action in ('pending','success','paid','trash') then
    if result.deleted_at is not null then raise exception 'Restore before editing.' using errcode='22023';end if;
    if action='trash' then update public.quotations set deleted_at=clock_timestamp() where id=target_quote returning * into result;
    elsif action<>result.status then update public.quotations set status=action where id=target_quote returning * into result;end if;
  else raise exception 'Invalid quotation action.' using errcode='22023';end if;
  return result;
end; $$;

create function public.company_sales_report(target_company uuid,start_date date,end_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare begin_at timestamptz; finish_at timestamptz; result jsonb;
begin
  perform public.salesgo_require_admin(target_company);
  if start_date is null or end_date is null or start_date>end_date or end_date-start_date>3660 then raise exception 'Invalid report dates.' using errcode='22023';end if;
  begin_at:=start_date::timestamp at time zone 'Asia/Kuala_Lumpur';finish_at:=(end_date+1)::timestamp at time zone 'Asia/Kuala_Lumpur';
  with q as materialized(select * from public.quotations where company_id=target_company and deleted_at is null),
    roster as(select m.user_id,m.role,m.is_primary,m.active,m.removed_at,coalesce(nullif(p.display_name,''),u.email::text,m.user_id::text) as name,u.email::text
      from public.company_members m join auth.users u on u.id=m.user_id left join public.account_profiles p on p.user_id=m.user_id where m.company_id=target_company),
    rows as(select r.*,count(q.id) filter(where q.created_at>=begin_at and q.created_at<finish_at) as quote_count,
      count(q.id) filter(where q.status in ('success','paid') and q.confirmed_at>=begin_at and q.confirmed_at<finish_at) as confirmed_count,
      coalesce(sum(q.total_amount) filter(where q.status in ('success','paid') and q.confirmed_at>=begin_at and q.confirmed_at<finish_at),0)::text as confirmed_amount,
      coalesce(sum(q.total_amount) filter(where q.status='paid' and q.paid_at>=begin_at and q.paid_at<finish_at),0)::text as paid_amount
      from roster r left join q on q.created_by=r.user_id group by r.user_id,r.role,r.is_primary,r.active,r.removed_at,r.name,r.email),
    goods as(select q.created_by,coalesce(nullif(item->'product'->>'unit',''),'未记录单位') as unit,sum((item->>'quantity')::numeric)::text as quantity
      from q cross join lateral jsonb_array_elements(q.items) item where q.status in ('success','paid') and q.confirmed_at>=begin_at and q.confirmed_at<finish_at
        and item->'product'->'is_service'='false'::jsonb group by q.created_by,coalesce(nullif(item->'product'->>'unit',''),'未记录单位'))
  select jsonb_build_object('timezone','Asia/Kuala_Lumpur','rows',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('goods',coalesce((select jsonb_agg(jsonb_build_object('unit',g.unit,'quantity',g.quantity) order by g.unit) from goods g where g.created_by=r.user_id),'[]'::jsonb)) order by r.confirmed_amount::numeric desc,r.name,r.user_id) from rows r),'[]'::jsonb),
    'legacy_undated',(select count(*) from q where status in ('success','paid') and confirmed_at is null)) into result;
  return result;
end; $$;

revoke all on function public.get_quotation_defaults(uuid),public.save_quotation_defaults(uuid,integer,text,integer,integer,text,text),
  public.search_company_customers(uuid,text,boolean,integer),public.create_quotation(uuid,uuid,jsonb),public.company_sales_report(uuid,date,date) from public,anon,authenticated;
grant execute on function public.get_quotation_defaults(uuid),public.save_quotation_defaults(uuid,integer,text,integer,integer,text,text),
  public.search_company_customers(uuid,text,boolean,integer),public.create_quotation(uuid,uuid,jsonb),public.company_sales_report(uuid,date,date) to authenticated;
commit;
