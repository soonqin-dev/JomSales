-- Run as postgres after migration 005. Synthetic rows roll back; no files/emails touched.
begin;
select set_config('salesgo.life.admin',gen_random_uuid()::text,true);
select set_config('salesgo.life.sales',gen_random_uuid()::text,true);
select set_config('salesgo.life.peer',gen_random_uuid()::text,true);
select set_config('salesgo.life.other',gen_random_uuid()::text,true);
select set_config('salesgo.life.company',gen_random_uuid()::text,true);
select set_config('salesgo.life.foreign',gen_random_uuid()::text,true);
select set_config('salesgo.life.quote',gen_random_uuid()::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at)
select current_setting('salesgo.life.'||key)::uuid,'authenticated','authenticated',key||'@salesgo-test.invalid',now()
from unnest(array['admin','sales','peer','other']) as key;
insert into public.companies(id,name) values(current_setting('salesgo.life.company')::uuid,'Lifecycle A'),(current_setting('salesgo.life.foreign')::uuid,'Lifecycle B');
insert into public.company_members(company_id,user_id,role) values
 (current_setting('salesgo.life.company')::uuid,current_setting('salesgo.life.admin')::uuid,'admin'),
 (current_setting('salesgo.life.company')::uuid,current_setting('salesgo.life.sales')::uuid,'sales'),
 (current_setting('salesgo.life.company')::uuid,current_setting('salesgo.life.peer')::uuid,'sales'),
 (current_setting('salesgo.life.foreign')::uuid,current_setting('salesgo.life.other')::uuid,'admin');
create or replace function pg_temp.check_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create or replace function pg_temp.expect_denied(command text) returns void language plpgsql as $$
begin
  begin execute command;
  exception when insufficient_privilege or check_violation or invalid_parameter_value or serialization_failure then return;
  end;
  raise exception 'FAIL: unexpectedly allowed: %',command;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.life.sales'),'role','authenticated')::text,true);
set local role authenticated;
insert into public.quotations(id,company_id,number,quote_date,customer_name) values
 (current_setting('salesgo.life.quote')::uuid,current_setting('salesgo.life.company')::uuid,'Q-LIFE',current_date,'Original customer');
select pg_temp.check_true((select status='pending' and creator_email='sales@salesgo-test.invalid' and deleted_at is null from public.quotations),'new pending with immutable server employee identity');
select pg_temp.expect_denied('update public.quotations set status=''success''');
select pg_temp.expect_denied('update public.quotations set deleted_at=now()');
select pg_temp.expect_denied('update public.quotations set creator_email=''forged''');
select pg_temp.expect_denied(format('select public.manage_quotation(%L,%L,1,''purge'')',current_setting('salesgo.life.company'),current_setting('salesgo.life.quote')));
select public.manage_quotation(current_setting('salesgo.life.company')::uuid,current_setting('salesgo.life.quote')::uuid,1,'success');
select pg_temp.check_true((select status='success' and revision=2 from public.quotations),'owner marks actual customer acceptance');
select pg_temp.expect_denied(format('select public.manage_quotation(%L,%L,1,''trash'')',current_setting('salesgo.life.company'),current_setting('salesgo.life.quote')));
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.life.peer'))::text,true);
select pg_temp.check_true((select count(*)=0 from public.quotations),'peer cannot view owner identity or quotation');
select pg_temp.expect_denied(format('select public.manage_quotation(%L,%L,2,''trash'')',current_setting('salesgo.life.company'),current_setting('salesgo.life.quote')));
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.life.other'))::text,true);
select pg_temp.expect_denied(format('select public.manage_quotation(%L,%L,2,''success'')',current_setting('salesgo.life.company'),current_setting('salesgo.life.quote')));
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.life.admin'))::text,true);
select pg_temp.check_true((select creator_email='sales@salesgo-test.invalid' from public.quotations),'admin sees creator email');
update public.quotations set notes='Admin edited' where id=current_setting('salesgo.life.quote')::uuid;
select pg_temp.check_true((select created_by=current_setting('salesgo.life.sales')::uuid and creator_email='sales@salesgo-test.invalid' and status='success' from public.quotations),'admin edit preserves owner and status');
select public.manage_quotation(current_setting('salesgo.life.company')::uuid,current_setting('salesgo.life.quote')::uuid,3,'trash');
select pg_temp.check_true((select count(*)=0 from public.quotations where deleted_at is null),'trash absent from active list');
with changed as(update public.quotations set notes='Invalid trash edit' returning id)
select pg_temp.check_true((select count(*)=0 from changed),'trash content cannot be edited');
select pg_temp.expect_denied(format('select public.manage_quotation(%L,%L,4,''success'')',current_setting('salesgo.life.company'),current_setting('salesgo.life.quote')));
select pg_temp.expect_denied('select public.purge_expired_quotations()');
select pg_temp.expect_denied('delete from public.quotations');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.life.sales'))::text,true);
select public.manage_quotation(current_setting('salesgo.life.company')::uuid,current_setting('salesgo.life.quote')::uuid,4,'restore');
select pg_temp.check_true((select number='Q-LIFE' and customer_name='Original customer' and status='success' and deleted_at is null from public.quotations),'restore retains number content ownership and status');
select public.manage_quotation(current_setting('salesgo.life.company')::uuid,current_setting('salesgo.life.quote')::uuid,5,'pending');
select public.manage_quotation(current_setting('salesgo.life.company')::uuid,current_setting('salesgo.life.quote')::uuid,6,'trash');
reset role;
update public.company_members set active=false where user_id=current_setting('salesgo.life.sales')::uuid;
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.quotations),'disabled owner loses trash access');
select pg_temp.expect_denied(format('select public.manage_quotation(%L,%L,7,''restore'')',current_setting('salesgo.life.company'),current_setting('salesgo.life.quote')));
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('salesgo.life.admin'))::text,true);
select pg_temp.check_true((select count(*)=1 from public.quotations),'admin retains disabled employee quote');
reset role;
update public.quotations set deleted_at=now()-interval '15 days' where id=current_setting('salesgo.life.quote')::uuid;
set local role authenticated;
select pg_temp.check_true((select count(*)=0 from public.quotations),'expired trash cannot be read even before worker runs');
select pg_temp.expect_denied(format('select public.manage_quotation(%L,%L,8,''restore'')',current_setting('salesgo.life.company'),current_setting('salesgo.life.quote')));
reset role;
set local role anon;
select pg_temp.expect_denied(format('select public.manage_quotation(%L,%L,8,''restore'')',current_setting('salesgo.life.company'),current_setting('salesgo.life.quote')));
select pg_temp.expect_denied('select public.purge_expired_quotations()');
reset role;
-- Do NOT invoke the global purge in this live verification script. Its physical
-- deletion behavior is tested separately in the isolated in-memory database.
select pg_temp.check_true((select count(*)=1 from public.quotations where id=current_setting('salesgo.life.quote')::uuid),'expired record awaits physical worker');
rollback;
select 'PASS: quotation status, employee identity, owner/admin isolation, trash/restore revisions, expiry and disabled/anonymous denial; fixtures rolled back.' as result;
