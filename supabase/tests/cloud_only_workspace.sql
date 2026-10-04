-- Run as postgres after 202610040004_cloud_only_workspace.sql.
-- All synthetic Auth/company/quotation records roll back. No emails/files touched.
begin;
select set_config('salesgo.cloud.admin',gen_random_uuid()::text,true);
select set_config('salesgo.cloud.sales',gen_random_uuid()::text,true);
select set_config('salesgo.cloud.peer',gen_random_uuid()::text,true);
select set_config('salesgo.cloud.other',gen_random_uuid()::text,true);
select set_config('salesgo.cloud.company',gen_random_uuid()::text,true);
select set_config('salesgo.cloud.foreign',gen_random_uuid()::text,true);
select set_config('salesgo.cloud.quote',gen_random_uuid()::text,true);
select set_config('salesgo.cloud.logo',current_setting('salesgo.cloud.company')||'/'||gen_random_uuid()||'.png',true);
insert into auth.users(id,aud,role,email,email_confirmed_at)
select current_setting('salesgo.cloud.'||key)::uuid,'authenticated','authenticated',
  current_setting('salesgo.cloud.'||key)||'@salesgo-test.invalid',now()
from unnest(array['admin','sales','peer','other']) as key;
insert into public.companies(id,name,created_by,contact,logo_path) values
  (current_setting('salesgo.cloud.company')::uuid,'Cloud A',current_setting('salesgo.cloud.admin')::uuid,'Contact A',current_setting('salesgo.cloud.logo')),
  (current_setting('salesgo.cloud.foreign')::uuid,'Cloud B',current_setting('salesgo.cloud.other')::uuid,'Contact B',null);
insert into public.company_members(company_id,user_id,role) values
  (current_setting('salesgo.cloud.company')::uuid,current_setting('salesgo.cloud.admin')::uuid,'admin'),
  (current_setting('salesgo.cloud.company')::uuid,current_setting('salesgo.cloud.sales')::uuid,'sales'),
  (current_setting('salesgo.cloud.company')::uuid,current_setting('salesgo.cloud.peer')::uuid,'sales'),
  (current_setting('salesgo.cloud.foreign')::uuid,current_setting('salesgo.cloud.other')::uuid,'admin');
create function pg_temp.check_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.expect_denied(command text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when insufficient_privilege or check_violation or unique_violation or invalid_parameter_value or serialization_failure then return;
  end;
  raise exception 'FAIL: unexpectedly allowed: %',command;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.cloud.sales'),'role','authenticated')::text,true);
set local role authenticated;
insert into public.quotations(id,company_id,number,quote_date,items,discount,customer_name,source_key)
values(current_setting('salesgo.cloud.quote')::uuid,current_setting('salesgo.cloud.company')::uuid,'Q-CLOUD','2026-10-04',
 '[{"product":{"id":"legacy-p","name":"Frozen product","serial":"P1"},"quantity":2,"unitPrice":12.5}]',5,'Customer A',null);
select pg_temp.check_true((select count(*)=1 from public.quotations where id=current_setting('salesgo.cloud.quote')::uuid),'sales can create/read own quote');
select pg_temp.check_true((select created_by=current_setting('salesgo.cloud.sales')::uuid and company_snapshot->>'name'='Cloud A' and company_snapshot->>'contact'='Contact A' from public.quotations where id=current_setting('salesgo.cloud.quote')::uuid),'server-stamped creator and brand snapshot');
select pg_temp.expect_denied(format('insert into public.quotations(company_id,number,quote_date) values(%L,''BAD'',current_date)',current_setting('salesgo.cloud.foreign')));
select pg_temp.expect_denied(format('insert into public.quotations(company_id,number,quote_date,source_key) values(%L,''BAD'',current_date,''legacy-key'')',current_setting('salesgo.cloud.company')));
select pg_temp.expect_denied(format('insert into public.quotations(company_id,created_by,number,quote_date) values(%L,%L,''BAD'',current_date)',current_setting('salesgo.cloud.company'),current_setting('salesgo.cloud.admin')));
select pg_temp.expect_denied(format('insert into public.quotations(company_id,company_snapshot,number,quote_date) values(%L,''{}'',''BAD'',current_date)',current_setting('salesgo.cloud.company')));
select pg_temp.expect_denied('update public.quotations set revision=90');
select pg_temp.expect_denied('update public.quotations set created_by=gen_random_uuid()');
select pg_temp.expect_denied('update public.quotations set company_snapshot=''{}''');
select pg_temp.expect_denied('delete from public.quotations');
select pg_temp.expect_denied('update public.quotations set discount=100000');
select pg_temp.expect_denied('update public.quotations set items=''{}''');
select pg_temp.expect_denied('update public.quotations set items=''[{"product":{"id":"x","serial":"S","name":"N"},"quantity":0,"unitPrice":1}]''');
select pg_temp.expect_denied('update public.quotations set items=''[{"product":{"id":"x","serial":"S","name":"N"},"quantity":1,"unitPrice":1.999}]''');
select pg_temp.expect_denied(format('select public.save_company_brand(%L,''Hacked'','''',null,1)',current_setting('salesgo.cloud.company')));
update public.quotations set customer_phone='+60 123' where id=current_setting('salesgo.cloud.quote')::uuid and revision=1;
select pg_temp.check_true((select revision=2 from public.quotations where id=current_setting('salesgo.cloud.quote')::uuid),'revision increments');
with changed as (update public.quotations set customer_phone='STALE' where id=current_setting('salesgo.cloud.quote')::uuid and revision=1 returning id)
select pg_temp.check_true((select count(*)=0 from changed),'stale update changes nothing');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.cloud.peer'),'role','authenticated')::text,true);
select pg_temp.check_true((select count(*)=0 from public.quotations where id=current_setting('salesgo.cloud.quote')::uuid),'peer sales cannot read quote');
with changed as(update public.quotations set notes='HACK' where id=current_setting('salesgo.cloud.quote')::uuid returning id)
select pg_temp.check_true((select count(*)=0 from changed),'peer cannot edit quote');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.cloud.other'),'role','authenticated')::text,true);
select pg_temp.check_true((select count(*)=0 from public.quotations where id=current_setting('salesgo.cloud.quote')::uuid),'foreign company cannot read quote');
select pg_temp.expect_denied(format('select public.save_company_brand(%L,''Hacked'','''',null,1)',current_setting('salesgo.cloud.company')));
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.cloud.admin'),'role','authenticated')::text,true);
select pg_temp.check_true((select count(*)=1 from public.quotations where id=current_setting('salesgo.cloud.quote')::uuid),'admin can view sales quote');
update public.quotations set notes='Admin edit' where id=current_setting('salesgo.cloud.quote')::uuid;
insert into public.quotations(company_id,number,quote_date,source_key) values(current_setting('salesgo.cloud.company')::uuid,'IMPORT',current_date,'cloud-test');
select pg_temp.expect_denied(format('insert into public.quotations(company_id,number,quote_date,source_key) values(%L,''DUP'',current_date,''cloud-test'')',current_setting('salesgo.cloud.company')));
select public.save_company_brand(current_setting('salesgo.cloud.company')::uuid,'Updated brand','New contact',null,1);
select pg_temp.expect_denied(format('select public.save_company_brand(%L,''STALE'','''',null,1)',current_setting('salesgo.cloud.company')));
select pg_temp.check_true((select company_snapshot->>'name'='Cloud A' and company_snapshot->>'logo_path'=current_setting('salesgo.cloud.logo') and items->0->'product'->>'name'='Frozen product' and items->0->>'unitPrice'='12.5' and created_by=current_setting('salesgo.cloud.sales')::uuid from public.quotations where id=current_setting('salesgo.cloud.quote')::uuid),'saved historical snapshots and creator remain immutable');
reset role;
update public.company_members set active=false where company_id=current_setting('salesgo.cloud.company')::uuid and user_id=current_setting('salesgo.cloud.sales')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.cloud.sales'),'role','authenticated')::text,true);
select pg_temp.check_true((select count(*)=0 from public.quotations where id=current_setting('salesgo.cloud.quote')::uuid),'disabled employee loses access');
select pg_temp.expect_denied(format('insert into public.quotations(company_id,number,quote_date) values(%L,''DISABLED'',current_date)',current_setting('salesgo.cloud.company')));
reset role;
set local role anon;
select set_config('request.jwt.claims','{}',true);
select pg_temp.expect_denied('select * from public.quotations');
select pg_temp.expect_denied(format('select public.save_company_brand(%L,''ANON'','''',null,2)',current_setting('salesgo.cloud.company')));
reset role;
select pg_temp.check_true((select rowsecurity from pg_tables where schemaname='public' and tablename='quotations'),'quotations RLS enabled');
select pg_temp.check_true((select not public and file_size_limit=1048576 from storage.buckets where id='salesgo-branding'),'branding bucket private and 1MB');
rollback;
select 'PASS: cloud quotations, owner/admin permissions, company isolation, immutable snapshots, revision conflicts, disabled/anonymous denial and branding restrictions; fixtures rolled back.' as result;
