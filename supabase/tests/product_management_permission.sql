-- Run as postgres AFTER the product-management permission migration.
-- Synthetic records are ALL rolled back; no emails or Storage files touched.
begin;
select set_config('salesgo.permission.admin',gen_random_uuid()::text,true);
select set_config('salesgo.permission.peer',gen_random_uuid()::text,true);
select set_config('salesgo.permission.other',gen_random_uuid()::text,true);
select set_config('salesgo.permission.sales',gen_random_uuid()::text,true);
select set_config('salesgo.permission.reader',gen_random_uuid()::text,true);
select set_config('salesgo.permission.company',gen_random_uuid()::text,true);
select set_config('salesgo.permission.foreign',gen_random_uuid()::text,true);
select set_config('salesgo.permission.product',gen_random_uuid()::text,true);
select set_config('salesgo.permission.foreign_product',gen_random_uuid()::text,true);
select set_config('salesgo.permission.new_product',gen_random_uuid()::text,true);
insert into auth.users(id,aud,role,email,email_confirmed_at)
select current_setting('salesgo.permission.'||key)::uuid,'authenticated','authenticated',
  current_setting('salesgo.permission.'||key)||'@salesgo-test.invalid',now()
from unnest(array['admin','peer','other','sales','reader']) as key;
insert into public.companies(id,name,created_by) values
  (current_setting('salesgo.permission.company')::uuid,'Permission test A',current_setting('salesgo.permission.admin')::uuid),
  (current_setting('salesgo.permission.foreign')::uuid,'Permission test B',current_setting('salesgo.permission.other')::uuid);
insert into public.company_members(company_id,user_id,role) values
  (current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.admin')::uuid,'admin'),
  (current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.peer')::uuid,'admin'),
  (current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.sales')::uuid,'sales'),
  (current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.reader')::uuid,'sales'),
  (current_setting('salesgo.permission.foreign')::uuid,current_setting('salesgo.permission.other')::uuid,'admin'),
  (current_setting('salesgo.permission.foreign')::uuid,current_setting('salesgo.permission.sales')::uuid,'sales');
insert into public.products(id,company_id,serial,name,price) values
  (current_setting('salesgo.permission.product')::uuid,current_setting('salesgo.permission.company')::uuid,'PERM-A','Product A',1),
  (current_setting('salesgo.permission.foreign_product')::uuid,current_setting('salesgo.permission.foreign')::uuid,'PERM-B','Product B',2);
create function pg_temp.check_true(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.expect_denied(command text) returns void language plpgsql as $$
begin
  begin execute command; raise exception 'FAIL: unexpectedly allowed: %',command;
  exception when insufficient_privilege or invalid_parameter_value then null;
  end;
end $$;
create function pg_temp.test_as(key text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',current_setting('salesgo.permission.'||key),true);
  select set_config('request.jwt.claims',json_build_object('sub',current_setting('salesgo.permission.'||key),'role','authenticated')::text,true);
$$;
create function pg_temp.check_update(command text,expected integer) returns void language plpgsql as $$
declare changed integer;
begin execute command; get diagnostics changed=row_count;
  if changed<>expected then raise exception 'FAIL: expected % changed rows, got %: %',expected,changed,command; end if;
end $$;

set local role authenticated;
select pg_temp.test_as('sales');
select pg_temp.check_true((select bool_and(not can_manage_products) from public.company_members),'existing sales members default read-only');
select pg_temp.expect_denied('update public.company_members set can_manage_products=true');
select pg_temp.expect_denied(format('select public.set_employee_product_permission(%L,%L,true)',current_setting('salesgo.permission.company'),current_setting('salesgo.permission.sales')));
select pg_temp.expect_denied(format('select public.get_company_team_permissions(%L)',current_setting('salesgo.permission.company')));
select pg_temp.expect_denied(format('insert into public.products(company_id,serial,name,price) values(%L,''NO'',''No permission'',1)',current_setting('salesgo.permission.company')));
select pg_temp.check_update(format('update public.products set name=''No permission'' where id=%L',current_setting('salesgo.permission.product')),0);
select pg_temp.check_update(format('update public.products set deleted_at=now() where id=%L',current_setting('salesgo.permission.product')),0);

select pg_temp.test_as('other');
select pg_temp.expect_denied(format('select public.set_employee_product_permission(%L,%L,true)',current_setting('salesgo.permission.company'),current_setting('salesgo.permission.sales')));
select pg_temp.test_as('admin');
select pg_temp.expect_denied(format('select public.set_employee_product_permission(%L,%L,false)',current_setting('salesgo.permission.company'),current_setting('salesgo.permission.admin')));
select pg_temp.expect_denied(format('select public.set_employee_product_permission(%L,%L,false)',current_setting('salesgo.permission.company'),current_setting('salesgo.permission.peer')));
select pg_temp.expect_denied(format('select public.set_employee_product_permission(%L,%L,true)',current_setting('salesgo.permission.company'),current_setting('salesgo.permission.other')));
select pg_temp.expect_denied(format('select public.set_employee_product_permission(%L,%L,null)',current_setting('salesgo.permission.company'),current_setting('salesgo.permission.sales')));
select public.set_employee_product_permission(current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.sales')::uuid,true);
select public.set_employee_product_permission(current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.sales')::uuid,true);
select pg_temp.check_true((select can_manage_products and active and role='sales' from public.get_company_team_permissions(current_setting('salesgo.permission.company')::uuid) where user_id=current_setting('salesgo.permission.sales')::uuid),'grant is idempotent and does not promote role');
select pg_temp.check_true((select count(*)=4 from public.get_company_team(current_setting('salesgo.permission.company')::uuid)),'legacy roster still works');

select pg_temp.test_as('sales');
insert into public.products(id,company_id,serial,name,price) values
  (current_setting('salesgo.permission.new_product')::uuid,current_setting('salesgo.permission.company')::uuid,'PERM-NEW','Created by sales',3);
select pg_temp.check_update(format('update public.products set name=''Edited by sales'',price=9.99 where id=%L and revision=1',current_setting('salesgo.permission.product')),1);
select pg_temp.check_update(format('update public.products set name=''Stale write'' where id=%L and revision=1',current_setting('salesgo.permission.product')),0);
select pg_temp.check_update(format('update public.products set deleted_at=now(),image_path=null where id=%L',current_setting('salesgo.permission.new_product')),1);
select pg_temp.expect_denied(format('insert into public.products(company_id,serial,name,price) values(%L,''CROSS'',''Cross company'',1)',current_setting('salesgo.permission.foreign')));
select pg_temp.check_update(format('update public.products set name=''Cross company'' where id=%L',current_setting('salesgo.permission.foreign_product')),0);
select pg_temp.check_update(format('update public.products set deleted_at=now() where id=%L',current_setting('salesgo.permission.foreign_product')),0);
select pg_temp.expect_denied(format('insert into public.products(company_id,serial,name,price,source_key) values(%L,''IMPORT'',''Import bypass'',1,''local-source'')',current_setting('salesgo.permission.company')));
select pg_temp.expect_denied('update public.company_members set role=''admin''');
select pg_temp.expect_denied('update public.company_members set active=true');
select pg_temp.expect_denied(format('update public.products set company_id=%L',current_setting('salesgo.permission.foreign')));
select pg_temp.expect_denied('update public.products set revision=99');
select pg_temp.expect_denied('delete from public.products');
select pg_temp.expect_denied(format('select public.get_company_team_permissions(%L)',current_setting('salesgo.permission.company')));
select pg_temp.expect_denied(format('select public.create_employee_invite(%L,''someone@example.test'',%L)',current_setting('salesgo.permission.company'),repeat('a',64)));
select pg_temp.expect_denied(format('select public.set_employee_active(%L,%L,false)',current_setting('salesgo.permission.company'),current_setting('salesgo.permission.reader')));
select pg_temp.expect_denied(format('select public.set_employee_product_permission(%L,%L,true)',current_setting('salesgo.permission.company'),current_setting('salesgo.permission.reader')));
select pg_temp.test_as('reader');
select pg_temp.check_update(format('update public.products set name=''Other employee bypass'' where id=%L',current_setting('salesgo.permission.product')),0);

select pg_temp.test_as('admin');
select public.set_employee_product_permission(current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.sales')::uuid,false);
select pg_temp.test_as('sales');
select pg_temp.check_true((select count(*)=2 from public.products where deleted_at is null),'revoking write access preserves company reads');
select pg_temp.check_update(format('update public.products set name=''Revoked write'' where id=%L',current_setting('salesgo.permission.product')),0);
select pg_temp.expect_denied(format('insert into public.products(company_id,serial,name,price) values(%L,''REVOKED'',''Revoked'',1)',current_setting('salesgo.permission.company')));
select pg_temp.check_update(format('update public.products set deleted_at=now() where id=%L',current_setting('salesgo.permission.product')),0);

select pg_temp.test_as('admin');
select public.set_employee_active(current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.sales')::uuid,false);
select public.set_employee_product_permission(current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.sales')::uuid,true);
select pg_temp.test_as('sales');
select pg_temp.check_true(not exists(select 1 from public.products where company_id=current_setting('salesgo.permission.company')::uuid),'inactive account overrides product permission');
select pg_temp.check_update(format('update public.products set name=''Inactive bypass'' where id=%L',current_setting('salesgo.permission.product')),0);
select pg_temp.expect_denied(format('insert into public.products(company_id,serial,name,price) values(%L,''INACTIVE'',''Inactive'',1)',current_setting('salesgo.permission.company')));
select pg_temp.test_as('admin');
select public.set_employee_active(current_setting('salesgo.permission.company')::uuid,current_setting('salesgo.permission.sales')::uuid,true);
select pg_temp.test_as('sales');
select pg_temp.check_update(format('update public.products set name=''Restored access'' where id=%L',current_setting('salesgo.permission.product')),1);

set local role anon;
select pg_temp.expect_denied(format('select public.set_employee_product_permission(%L,%L,true)',current_setting('salesgo.permission.company'),current_setting('salesgo.permission.sales')));
select pg_temp.expect_denied(format('select public.get_company_team_permissions(%L)',current_setting('salesgo.permission.company')));
rollback;
select 'PASS: grouped product permission, default read-only, admin-only settings, CRUD, revoke, inactive override, cross-company isolation and role protection. Test records rolled back.' as result;
