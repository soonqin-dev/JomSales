const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
test("cloud-only PostgreSQL migration, live verification and private historical logos", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
      create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$;
      grant usage on schema auth,storage to authenticated,anon;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
      alter table storage.objects enable row level security; grant select,insert,update,delete on storage.objects to authenticated,anon;
      create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;`);
    const existingUser="70000000-0000-4000-a000-000000000001",existingCompany="70000000-0000-4000-a000-000000000010";
    for (const file of readdirSync(join(__dirname,"../supabase/migrations")).filter(f => f.endsWith(".sql")).sort()) {
      if (file === "202610040005_quotation_lifecycle.sql") await db.exec(`
        insert into auth.users(id,email) values('${existingUser}','existing@example.test');
        insert into public.companies(id,name) values('${existingCompany}','Original brand');
        insert into public.quotations(company_id,created_by,number,quote_date,customer_name,notes,source_key)
        values('${existingCompany}','${existingUser}','EXISTING',current_date,'Original customer','Original note','legacy-source');`);
      await db.exec(readFileSync(join(__dirname,"../supabase/migrations",file),"utf8"));
    }
    const migrated=(await db.query(`select * from public.quotations where company_id='${existingCompany}'`)).rows[0];
    assert.equal(migrated.status,"pending");assert.equal(migrated.creator_email,"existing@example.test");assert.equal(migrated.deleted_at,null);
    assert.equal(migrated.customer_name,"Original customer");assert.equal(migrated.notes,"Original note");assert.equal(migrated.source_key,"legacy-source");assert.equal(migrated.company_snapshot.name,"Original brand");
    // Remove only the synthetic compatibility seed in this local database.
    await db.exec(`delete from public.quotations where company_id='${existingCompany}';delete from public.companies where id='${existingCompany}';delete from auth.users where id='${existingUser}';`);
    for (const file of ["company_isolation.sql","employee_invitations.sql","product_management_permission.sql","cloud_only_workspace.sql","quotation_lifecycle.sql"]) {
      await db.exec(readFileSync(join(__dirname,"../supabase/tests",file),"utf8"));
      for (const table of ["auth.users","public.companies","public.company_members","public.company_invitations","public.products","public.quotations","storage.objects"]) assert.equal((await db.query(`select * from ${table}`)).rows.length,0,`${file} rolled back ${table}`);
    }
    // Storage metadata below exists ONLY in this in-memory database, not live Storage.
    const uuid = n => `40000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
    const admin=uuid(1),sales=uuid(2),other=uuid(3),co=uuid(10),foreign=uuid(11);
    const live=`${co}/${uuid(30)}.png`,old=`${co}/${uuid(31)}.png`,unused=`${co}/${uuid(32)}.png`,alien=`${foreign}/${uuid(33)}.png`;
    await db.exec(`insert into auth.users(id) values('${admin}'),('${sales}'),('${other}');
      insert into public.companies(id,name,logo_path) values('${co}','A','${live}'),('${foreign}','B','${alien}');
      insert into public.company_members(company_id,user_id,role) values('${co}','${admin}','admin'),('${co}','${sales}','sales'),('${foreign}','${other}','admin');
      insert into public.quotations(company_id,created_by,number,quote_date) values('${co}','${sales}','Q',current_date);
      update public.companies set logo_path='${old}' where id='${co}';
      insert into storage.objects(bucket_id,name) values('salesgo-branding','${live}'),('salesgo-branding','${old}'),('salesgo-branding','${unused}'),('salesgo-branding','${alien}');`);
    async function as(user, sql, role="authenticated") {
      await db.exec(`begin; set local role ${role}; select set_config('request.jwt.claims','${user ? JSON.stringify({sub:user}) : '{}'}',true);`);
      try { return await db.query(sql); } finally { await db.exec("rollback"); }
    }
    assert.equal((await as(sales,"select * from storage.objects")).rows.length,3);
    assert.equal((await as(other,"select * from storage.objects")).rows.length,1);
    assert.equal((await as(null,"select * from storage.objects","anon")).rows.length,0);
    const upload=`insert into storage.objects(bucket_id,name) values('salesgo-branding','${co}/${uuid(40)}.webp') returning id`;
    assert.equal((await as(admin,upload)).rows.length,1);
    await assert.rejects(as(sales,upload),/row-level security/);
    await assert.rejects(as(other,upload),/row-level security/);
    assert.equal((await as(admin,"update storage.objects set name='overwrite' returning id")).rows.length,0);
    for(const path of [live,old,alien]) assert.equal((await as(admin,`delete from storage.objects where name='${path}' returning id`)).rows.length,0,"referenced/foreign logo retained");
    assert.equal((await as(admin,`delete from storage.objects where name='${unused}' returning id`)).rows.length,1);
    assert.equal((await as(sales,`delete from storage.objects where name='${unused}' returning id`)).rows.length,0);
    await db.exec(`update public.company_members set active=false where user_id='${admin}'`);
    await assert.rejects(as(admin,upload),/row-level security/);
    assert.equal((await as(admin,"select * from storage.objects")).rows.length,0);
    // Physical expiry is tested ONLY in this isolated database. Never purge live
    // project trash while running the rollback-only SQL Editor verification.
    await db.exec(`insert into public.quotations(company_id,created_by,number,quote_date,deleted_at) values
      ('${co}','${sales}','EXPIRED',current_date,now()-interval '15 days'),
      ('${co}','${sales}','RECOVERABLE',current_date,now()-interval '14 days');`);
    const imagesBefore=(await db.query("select * from storage.objects order by name")).rows;
    assert.equal((await db.query("select public.purge_expired_quotations() as removed")).rows[0].removed,1);
    assert.equal((await db.query("select count(*)::integer as count from public.quotations")).rows[0].count,2,"live/recoverable quotes survive");
    assert.deepEqual((await db.query("select * from storage.objects order by name")).rows,imagesBefore,"worker never deletes images");
    assert.equal((await db.query("select public.purge_expired_quotations() as removed")).rows[0].removed,0,"worker is idempotent");
  } finally { await db.close(); }
});
