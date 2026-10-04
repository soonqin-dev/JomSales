-- Run as postgres after ALL THREE migrations succeed. Uses synthetic users,
-- rolls back ALL test records, sends no mail and touches no physical files.
begin;
select set_config('salesgo.invite.admin', gen_random_uuid()::text, true);
select set_config('salesgo.invite.other', gen_random_uuid()::text, true);
select set_config('salesgo.invite.employee', gen_random_uuid()::text, true);
select set_config('salesgo.invite.unverified', gen_random_uuid()::text, true);
select set_config('salesgo.invite.company', gen_random_uuid()::text, true);
select set_config('salesgo.invite.foreign', gen_random_uuid()::text, true);

insert into auth.users(id,aud,role,email,email_confirmed_at)
select current_setting('salesgo.invite.' || key)::uuid, 'authenticated', 'authenticated',
  current_setting('salesgo.invite.' || key) || '@salesgo-test.invalid',
  case when key='unverified' then null else now() end
from unnest(array['admin','other','employee','unverified']) as key;
insert into public.companies(id,name,created_by) values
  (current_setting('salesgo.invite.company')::uuid,'Invitation test A',current_setting('salesgo.invite.admin')::uuid),
  (current_setting('salesgo.invite.foreign')::uuid,'Invitation test B',current_setting('salesgo.invite.other')::uuid);
insert into public.company_members(company_id,user_id,role) values
  (current_setting('salesgo.invite.company')::uuid,current_setting('salesgo.invite.admin')::uuid,'admin'),
  (current_setting('salesgo.invite.foreign')::uuid,current_setting('salesgo.invite.other')::uuid,'admin');
insert into public.products(company_id,serial,name,price) values
  (current_setting('salesgo.invite.company')::uuid,'INVITE-A','Invitation test product',1),
  (current_setting('salesgo.invite.foreign')::uuid,'INVITE-B','Foreign product',2);

-- Temporary, invoker-security assertion helpers; disappear on rollback.
create function pg_temp.check_true(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %', label; end if; end $$;
create function pg_temp.expect_denied(command text) returns void language plpgsql as $$
begin
  begin execute command; raise exception 'FAIL: unexpectedly allowed: %', command;
  exception when insufficient_privilege or invalid_parameter_value then null;
  end;
end $$;
create function pg_temp.test_as(key text) returns void language sql as $$
  select set_config('request.jwt.claim.sub',current_setting('salesgo.invite.' || key),true);
  select set_config('request.jwt.claims',json_build_object('sub',current_setting('salesgo.invite.' || key),'role','authenticated')::text,true);
$$;

set local role authenticated;
select pg_temp.test_as('admin');
select pg_temp.expect_denied('select * from public.company_invitations');
select pg_temp.expect_denied(format('select public.salesgo_require_admin(%L)',current_setting('salesgo.invite.company')));
select pg_temp.expect_denied(format('select public.get_company_team(%L)',current_setting('salesgo.invite.foreign')));
select pg_temp.expect_denied(format('select public.create_employee_invite(%L,''invalid email'',%L)',current_setting('salesgo.invite.company'),repeat('a',64)));
select pg_temp.expect_denied(format('select public.create_employee_invite(%L,''someone@example.test'',''bad-token'')',current_setting('salesgo.invite.company')));
select pg_temp.expect_denied(format('select public.set_employee_active(%L,%L,false)',current_setting('salesgo.invite.company'),current_setting('salesgo.invite.admin')));
select pg_temp.expect_denied(format('select public.set_employee_active(%L,%L,false)',current_setting('salesgo.invite.company'),current_setting('salesgo.invite.other')));

select set_config('salesgo.invite.first',public.create_employee_invite(
  current_setting('salesgo.invite.company')::uuid,
  ' ' || upper(current_setting('salesgo.invite.employee')) || '@SALESGO-TEST.INVALID ',repeat('a',64))::text,true);
select pg_temp.check_true(public.create_employee_invite(current_setting('salesgo.invite.company')::uuid,
  current_setting('salesgo.invite.employee') || '@salesgo-test.invalid',repeat('a',64))::text=current_setting('salesgo.invite.first'),'lost-response retry is idempotent');
select pg_temp.check_true((select count(*)=1 from public.get_company_invitations(current_setting('salesgo.invite.company')::uuid)),'one invitation on retry');
select pg_temp.check_true((select count(*)=1 from public.get_company_team(current_setting('salesgo.invite.company')::uuid)),'only own company roster');
select public.create_employee_invite(current_setting('salesgo.invite.company')::uuid,
  current_setting('salesgo.invite.employee') || '@salesgo-test.invalid',repeat('b',64));
select pg_temp.check_true((select revoked_at is not null from public.get_company_invitations(current_setting('salesgo.invite.company')::uuid) where id=current_setting('salesgo.invite.first')::uuid),'replacement revokes old link');
select public.create_employee_invite(current_setting('salesgo.invite.company')::uuid,
  current_setting('salesgo.invite.unverified') || '@salesgo-test.invalid',repeat('c',64));

select pg_temp.test_as('other');
select pg_temp.expect_denied(format('select public.get_company_invitations(%L)',current_setting('salesgo.invite.company')));
select pg_temp.expect_denied(format('select public.create_employee_invite(%L,''someone@example.test'',%L)',current_setting('salesgo.invite.company'),repeat('d',64)));
select pg_temp.expect_denied(format('select public.get_employee_invite(%L)',repeat('b',64)));
select pg_temp.expect_denied(format('select public.accept_employee_invite(%L)',repeat('b',64)));

select pg_temp.test_as('unverified');
select pg_temp.expect_denied(format('select public.get_employee_invite(%L)',repeat('c',64)));
select pg_temp.expect_denied(format('select public.accept_employee_invite(%L)',repeat('c',64)));

select pg_temp.test_as('employee');
select pg_temp.expect_denied(format('select public.get_employee_invite(%L)',repeat('a',64)));
select pg_temp.expect_denied(format('select public.accept_employee_invite(%L)',repeat('a',64)));
select pg_temp.check_true((select count(*)=1 from public.get_employee_invite(repeat('b',64))),'verified matching email can preview');
select pg_temp.check_true(public.accept_employee_invite(repeat('b',64))=current_setting('salesgo.invite.company')::uuid,'accept joins invited company');
select pg_temp.check_true(public.accept_employee_invite(repeat('b',64))=current_setting('salesgo.invite.company')::uuid,'accept retry is idempotent');
select pg_temp.check_true((select count(*)=1 from public.company_members where role='sales' and active),'exactly one sales membership');
select pg_temp.check_true((select count(*)=1 from public.products),'sales reads only company product');
select pg_temp.expect_denied(format('select public.get_company_team(%L)',current_setting('salesgo.invite.company')));
select pg_temp.expect_denied(format('select public.create_employee_invite(%L,''someone@example.test'',%L)',current_setting('salesgo.invite.company'),repeat('d',64)));
select pg_temp.expect_denied('update public.company_members set role=''admin''');
select pg_temp.expect_denied(format('insert into public.products(company_id,serial,name,price) values (%L,''HACK'',''No'',1)',current_setting('salesgo.invite.company')));

select pg_temp.test_as('admin');
select public.set_employee_active(current_setting('salesgo.invite.company')::uuid,current_setting('salesgo.invite.employee')::uuid,false);
select pg_temp.check_true((select count(*)=1 from public.products),'stopping employee preserves product');
select pg_temp.expect_denied(format('select public.create_employee_invite(%L,%L,%L)',current_setting('salesgo.invite.company'),current_setting('salesgo.invite.employee') || '@salesgo-test.invalid',repeat('d',64)));
select public.revoke_employee_invite(current_setting('salesgo.invite.company')::uuid,
  (select id from public.get_company_invitations(current_setting('salesgo.invite.company')::uuid) where email=current_setting('salesgo.invite.unverified') || '@salesgo-test.invalid'));
select pg_temp.test_as('employee');
select pg_temp.check_true(not exists(select 1 from public.products),'disabled employee product reads denied');
select pg_temp.expect_denied(format('select public.accept_employee_invite(%L)',repeat('b',64)));
select pg_temp.test_as('admin');
select public.set_employee_active(current_setting('salesgo.invite.company')::uuid,current_setting('salesgo.invite.employee')::uuid,true);
select pg_temp.test_as('employee');
select pg_temp.check_true((select count(*)=1 from public.products),'reenabled employee reads same preserved product');

-- Owner-only fixture edits to test expiry, verified-but-revoked and inactive inviter.
reset role;
update auth.users set email_confirmed_at=now() where id=current_setting('salesgo.invite.unverified')::uuid;
set local role authenticated;
select pg_temp.test_as('unverified');
select pg_temp.expect_denied(format('select public.accept_employee_invite(%L)',repeat('c',64)));
select pg_temp.test_as('admin');
select public.create_employee_invite(current_setting('salesgo.invite.company')::uuid,
  current_setting('salesgo.invite.unverified') || '@salesgo-test.invalid',repeat('e',64));
reset role;
update public.company_invitations set expires_at=now()-interval '1 second' where token_hash=encode(sha256(convert_to(repeat('e',64),'UTF8')),'hex');
set local role authenticated;
select pg_temp.test_as('unverified');
select pg_temp.expect_denied(format('select public.get_employee_invite(%L)',repeat('e',64)));
select pg_temp.expect_denied(format('select public.accept_employee_invite(%L)',repeat('e',64)));
select pg_temp.test_as('admin');
select public.create_employee_invite(current_setting('salesgo.invite.company')::uuid,
  current_setting('salesgo.invite.unverified') || '@salesgo-test.invalid',repeat('f',64));
reset role;
update public.company_members set active=false where user_id=current_setting('salesgo.invite.admin')::uuid;
set local role authenticated;
select pg_temp.test_as('unverified');
select pg_temp.expect_denied(format('select public.accept_employee_invite(%L)',repeat('f',64)));
select pg_temp.test_as('admin');
select pg_temp.expect_denied(format('select public.get_company_team(%L)',current_setting('salesgo.invite.company')));
set local role anon;
select pg_temp.expect_denied(format('select public.get_employee_invite(%L)',repeat('f',64)));
select pg_temp.expect_denied(format('select public.accept_employee_invite(%L)',repeat('f',64)));
select pg_temp.expect_denied(format('select public.get_company_team(%L)',current_setting('salesgo.invite.company')));
rollback;
select 'PASS: employee invites, verified-email binding, company isolation, protected admins, expiry/revocation, retry and disable/restore. Test records rolled back.' as result;
