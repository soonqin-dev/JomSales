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
    for (const file of readdirSync(join(__dirname,"../supabase/migrations")).filter(f => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(__dirname,"../supabase/migrations",file),"utf8"));
    for (const file of ["company_isolation.sql","employee_invitations.sql","product_management_permission.sql","cloud_only_workspace.sql"]) {
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
  } finally { await db.close(); }
});
