const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const uuid = n => `80000000-0000-4000-a000-${String(n).padStart(12,"0")}`;

test("Launchpad accounts: real PostgreSQL permissions, protected primary, suspension and platform provisioning", async t => {
  const db = new PGlite();
  const platform=uuid(1),owner=uuid(2),deputy=uuid(3),sales=uuid(4),other=uuid(5),newcomer=uuid(6),co=uuid(10),foreign=uuid(11),fresh=uuid(12),product=uuid(20),quote=uuid(30);
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
      create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      grant usage on schema auth,storage to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb default '{}');
      alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;`);
    for (const file of readdirSync(join(__dirname,"../supabase/migrations")).filter(f=>f.endsWith(".sql")).sort()) {
      if (file.startsWith("202610060001")) {
        await db.exec(`insert into auth.users(id,email,email_confirmed_at) values
          ('${platform}','platform@test.example',now()),('${owner}','owner@test.example',now()),('${deputy}','deputy@test.example',now()),
          ('${sales}','sales@test.example',now()),('${other}','other@test.example',now());
          insert into public.companies(id,name,created_by) values('${co}','Company A','${owner}'),('${foreign}','Company B','${other}');
          insert into public.company_members(company_id,user_id,role) values
            ('${co}','${owner}','admin'),('${co}','${deputy}','admin'),('${co}','${sales}','sales'),('${foreign}','${sales}','sales'),('${foreign}','${other}','admin');
          insert into public.products(id,company_id,serial,name,price) values('${product}','${co}','001','Existing part',12);
          insert into public.quotations(id,company_id,created_by,number,quote_date,customer_name) values('${quote}','${co}','${sales}','OLD',current_date,'Original customer');
          insert into storage.objects(bucket_id,name,metadata) values('salesgo-products','${co}/${product}/${uuid(40)}.png','{"size":1200}');`);
      }
      await db.exec(readFileSync(join(__dirname,"../supabase/migrations",file),"utf8"));
    }
    await db.exec(`insert into public.platform_admins(user_id) values('${platform}');
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('${newcomer}','new@test.example',now(),'{"display_name":"新员工","role":"admin","platform_admin":true}');`);
    await db.exec(readFileSync(join(__dirname,"../supabase/tests/launchpad_accounts.sql"),"utf8"));
    async function as(user,sql,{commit=false,role="authenticated",aal="aal1"}={}) {
      await db.exec(`begin;set local role ${role};select set_config('request.jwt.claims','${JSON.stringify(user?{sub:user,aal}:{})}',true);`);
      try {const result=await db.query(sql);await db.exec(commit?"commit":"rollback");return result.rows;}
      catch(err){await db.exec("rollback");throw err;}
    }
    await t.test("legacy data preserved; primary selected only from recorded creator; signup metadata grants no role", async()=>{
      assert.equal((await db.query(`select is_primary from public.company_members where company_id='${co}' and user_id='${owner}'`)).rows[0].is_primary,true);
      assert.equal((await db.query(`select is_primary from public.company_members where company_id='${co}' and user_id='${deputy}'`)).rows[0].is_primary,false);
      const original=(await db.query(`select * from public.quotations where id='${quote}'`)).rows[0];
      assert.equal(original.creator_name,"");assert.equal(original.creator_email,"sales@test.example");assert.equal(original.customer_name,"Original customer");
      assert.equal((await db.query(`select display_name from public.account_profiles where user_id='${newcomer}'`)).rows[0].display_name,"新员工");
      assert.equal((await as(newcomer,"select public.is_platform_admin() as allowed"))[0].allowed,false);
      assert.equal((await as(newcomer,"select * from public.company_members")).length,0);
    });
    await t.test("old create-company endpoint and direct privileged writes are closed",async()=>{
      for (const user of [sales,owner,platform]) await assert.rejects(as(user,"select public.create_company('Forbidden')"),/permission denied/);
      await assert.rejects(as(sales,`insert into public.platform_admins values('${sales}',true,false)`),/permission denied/);
      await assert.rejects(as(owner,`update public.company_members set is_primary=true where user_id='${deputy}'`),/permission denied/);
      await assert.rejects(as(owner,"select * from public.company_entitlements"),/permission denied/);
      await assert.rejects(as(sales,"select * from public.platform_audit"),/permission denied/);
    });
    await t.test("profiles private, validated and revision guarded; quote name is immutable snapshot",async()=>{
      assert.equal((await as(sales,"select * from public.account_profiles")).length,1);
      await assert.rejects(as(sales,"select public.save_account_profile('', '',1)"),/Name required/);
      await assert.rejects(as(sales,"select public.save_account_profile('Sales', '0123456789',1)"),/WhatsApp/);
      await as(sales,"select public.save_account_profile('销售甲','+60123456789',1)",{commit:true});
      await assert.rejects(as(sales,"select public.save_account_profile('Stale','',1)"),/Profile changed/);
      const newQuote=uuid(31);
      await as(sales,`insert into public.quotations(id,company_id,number,quote_date) values('${newQuote}','${co}','NEW',current_date)`,{commit:true});
      await as(sales,"select public.save_account_profile('新姓名','',2)",{commit:true});
      assert.equal((await db.query(`select creator_name from public.quotations where id='${newQuote}'`)).rows[0].creator_name,"销售甲");
      assert.equal((await db.query(`select creator_name from public.quotations where id='${quote}'`)).rows[0].creator_name,"");
      await assert.rejects(as(sales,`update public.quotations set creator_name='Forgery' where id='${newQuote}'`),/permission denied/);
    });
    await t.test("primary/deputy boundaries enforced at RPC not just UI",async()=>{
      for(const action of ["disable","remove","demote"])await assert.rejects(as(deputy,`select public.manage_company_member('${co}','${owner}','${action}')`),/protected/);
      await assert.rejects(as(deputy,`select public.manage_company_member('${co}','${sales}','promote')`),/Only the primary/);
      await assert.rejects(as(sales,`select * from public.get_company_roster('${co}')`),/Administrator/);
      await assert.rejects(as(other,`select * from public.get_company_roster('${co}')`),/Administrator/);
      await as(owner,`select public.manage_company_member('${co}','${sales}','promote')`,{commit:true});
      assert.equal((await db.query(`select role,is_primary from public.company_members where company_id='${co}' and user_id='${sales}'`)).rows[0].role,"admin");
      await assert.rejects(as(deputy,`select public.set_employee_active('${co}','${sales}',false)`),/Only the primary/);
      await as(owner,`select public.manage_company_member('${co}','${sales}','demote')`,{commit:true});
    });
    await t.test("remove retains records, isolates company, prevents old-invite resurrection; fresh invite works",async()=>{
      const token="a".repeat(64);
      await as(owner,`select public.create_employee_invite('${co}','new@test.example','${token}')`,{commit:true});
      await as(newcomer,`select public.accept_employee_invite('${token}')`,{commit:true});
      await as(owner,`select public.manage_company_member('${co}','${newcomer}','remove')`,{commit:true});
      await assert.rejects(as(newcomer,`select public.accept_employee_invite('${token}')`),/revoked/);
      await assert.rejects(as(owner,`select public.set_employee_active('${co}','${newcomer}',true)`),/rejoin/);
      const next="b".repeat(64);
      await as(owner,`select public.create_employee_invite('${co}','new@test.example','${next}')`,{commit:true});
      await as(newcomer,`select public.accept_employee_invite('${next}')`,{commit:true});
      await as(owner,`select public.manage_company_member('${co}','${sales}','remove')`,{commit:true});
      assert.equal((await as(sales,`select * from public.company_members`)).length,1,"other company remains accessible");
      assert.equal((await as(sales,`select * from public.products where company_id='${co}'`)).length,0);
      assert.equal((await db.query(`select * from public.quotations where created_by='${sales}'`)).rows.length,2);
      const last="c".repeat(64);
      await as(owner,`select public.create_employee_invite('${co}','sales@test.example','${last}')`,{commit:true});
      await as(sales,`select public.accept_employee_invite('${last}')`,{commit:true});
    });
    await t.test("platform guard denies all tenant users; explicit allowlist optional AAL2 enforcement",async()=>{
      for(const user of [owner,sales,newcomer]) await assert.rejects(as(user,"select * from public.platform_list_companies('',0)"),/Platform administrator/);
      await assert.rejects(as(null,"select public.is_platform_admin()",{role:"anon"}),/permission denied/);
      assert.equal((await as(platform,"select * from public.platform_list_companies('',0)")).length,2);
      await db.exec(`update public.platform_admins set require_mfa=true where user_id='${platform}'`);
      await assert.rejects(as(platform,"select * from public.platform_list_companies('',0)"),/Platform administrator/);
      assert.equal((await as(platform,"select * from public.platform_list_companies('',0)",{aal:"aal2"})).length,2);
      await db.exec(`update public.platform_admins set require_mfa=false where user_id='${platform}'`);
      assert.equal((await as(platform,"select * from public.quotations")).length,0,"platform role does not implicitly read tenant quotes");
    });
    await t.test("platform creates company + verified-email primary invitation atomically and retries safely",async()=>{
      const token="d".repeat(64),sql=`select public.platform_create_company('${fresh}','New company','new@test.example','${token}')`;
      await as(platform,sql,{commit:true});await as(platform,sql,{commit:true});
      assert.equal((await db.query(`select count(*)::int as n from public.company_invitations where company_id='${fresh}'`)).rows[0].n,1);
      await assert.rejects(as(owner,`select public.accept_employee_invite('${token}')`),/Invalid invitation/);
      assert.equal((await as(newcomer,`select * from public.get_join_invitation('${token}')`))[0].invite_role,"primary");
      await as(newcomer,`select public.accept_employee_invite('${token}')`,{commit:true});
      const primary=(await db.query(`select role,is_primary from public.company_members where company_id='${fresh}'`)).rows[0];
      assert.equal(primary.role,"admin");assert.equal(primary.is_primary,true);
      await assert.rejects(as(platform,`select public.platform_primary_invite('${fresh}','other@test.example','${"e".repeat(64)}')`),/already assigned/);
    });
    await t.test("platform suspension denies products, quotes, image metadata, RPCs and invites without deleting",async()=>{
      const config=`select public.platform_update_company('${co}',1,'suspended',null,'Pro',5,10000,5000,'{}')`;
      await as(platform,config,{commit:true});
      for(const table of ["products","quotations","company_members"]) assert.equal((await as(owner,`select * from public.${table} where company_id='${co}'`)).length,0);
      assert.equal((await as(owner,"select * from storage.objects")).length,0);
      await assert.rejects(as(owner,`insert into public.products(company_id,serial,name,price) values('${co}','FAIL','Denied',1)`),/row-level security/);
      await assert.rejects(as(owner,`insert into storage.objects(bucket_id,name) values('salesgo-products','${co}/${product}/${uuid(41)}.png')`),/row-level security/);
      await assert.rejects(as(owner,`select public.manage_quotation('${co}','${quote}',1,'trash')`),/Company unavailable/);
      await assert.rejects(as(owner,`select public.save_company_brand('${co}','Denied','',null,1)`),/Administrator/);
      await assert.rejects(as(owner,`select public.create_employee_invite('${co}','new2@test.example','${"f".repeat(64)}')`),/Administrator/);
      assert.equal((await db.query(`select * from public.products where id='${product}'`)).rows.length,1);
      await assert.rejects(as(platform,config),/Company changed/);
      await as(platform,`select public.platform_update_company('${co}',2,'active',null,'Pro',5,10000,5000,'{}')`,{commit:true});
      assert.equal((await as(owner,`select * from public.products where company_id='${co}'`)).length,1);
      const usage=await as(platform,"select * from public.platform_list_companies('Company A',0)");assert.equal(Number(usage[0].storage_bytes),1200);
    });
    await t.test("explicit expiry closes membership; platform transfer protects last primary",async()=>{
      await as(platform,`select public.platform_update_company('${co}',3,'active',now()-interval '1 second','Lite',null,null,null,'{}')`,{commit:true});
      assert.equal((await as(owner,"select * from public.company_members")).length,0);
      await as(platform,`select public.platform_update_company('${co}',4,'active',null,'Lite',null,null,null,'{}')`,{commit:true});
      await assert.rejects(as(platform,`select public.platform_manage_member('${co}','${owner}','remove')`),/Transfer/);
      await as(platform,`select public.platform_manage_member('${co}','${deputy}','make_primary')`,{commit:true});
      assert.equal((await db.query(`select is_primary from public.company_members where company_id='${co}' and user_id='${deputy}'`)).rows[0].is_primary,true);
      const audits=await as(platform,`select * from public.platform_audit_list('${co}')`);assert(audits.length>0);
    });
    await t.test("stored member quota is enforced at invitation acceptance, not only form",async()=>{
      await as(platform,`select public.platform_update_company('${co}',5,'active',null,'Lite',1,null,null,'{}')`,{commit:true});
      await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${uuid(7)}','quota@test.example',now())`);
      await as(deputy,`select public.create_employee_invite('${co}','quota@test.example','${"1".repeat(64)}')`,{commit:true});
      await assert.rejects(as(uuid(7),`select public.accept_employee_invite('${"1".repeat(64)}')`),/quota/);
    });
  } finally { await db.close(); }
});
