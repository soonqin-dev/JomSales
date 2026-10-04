const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

test("employee invitation and product permission SQL run unmodified in PostgreSQL and roll back all fixtures", async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as
        $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$;
      grant usage on schema auth,storage to authenticated,anon;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects to authenticated,anon;
      create function storage.foldername(name text) returns text[] language sql immutable as
        $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    `);
    for (const file of ["202610030001_company_accounts.sql", "202610040001_cloud_products.sql", "202610040002_employee_invitations.sql", "202610040003_product_management_permission.sql"]) {
      await db.exec(readFileSync(join(__dirname, "../supabase/migrations", file), "utf8"));
    }
    await db.exec(readFileSync(join(__dirname, "../supabase/tests/employee_invitations.sql"), "utf8"));
    for (const table of ["auth.users", "public.companies", "public.company_members", "public.company_invitations", "public.products", "storage.objects"]) {
      assert.equal((await db.query(`select * from ${table}`)).rows.length, 0, `${table}: test records must roll back`);
    }
    const columns = (await db.query("select proargnames from pg_proc where oid='public.get_company_invitations(uuid)'::regprocedure")).rows[0].proargnames.slice(1);
    assert.deepEqual(columns, ["id", "email", "created_at", "expires_at", "revoked_at", "accepted_at"]);
    assert.equal((await db.query("select rowsecurity from pg_tables where tablename='company_invitations'")).rows[0].rowsecurity, true);
    // Existing product/storage policies also run after the new grants/functions.
    await db.exec(readFileSync(join(__dirname, "../supabase/tests/company_isolation.sql"), "utf8"));
    await t.test("live SQL verification covers grouped CRUD and privilege escalation protection", async () => {
      await db.exec(readFileSync(join(__dirname, "../supabase/tests/product_management_permission.sql"), "utf8"));
      for (const table of ["auth.users", "public.companies", "public.company_members", "public.company_invitations", "public.products"]) {
        assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
      }
    });
    await t.test("authorized sales image uploads/cleanup obey company scope and live references; revoke and inactivity override", async () => {
      // Mock Storage metadata exists ONLY in this in-memory test database.
      // Never run these fixture inserts/deletes against physical Supabase files.
      const uid = n => `30000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
      const admin = uid(1), sales = uid(2), ca = uid(10), cb = uid(11), pa = uid(20), pb = uid(21);
      const live = `${ca}/${pa}/${uid(30)}.png`, unused = `${ca}/${pa}/${uid(31)}.png`, foreign = `${cb}/${pb}/${uid(32)}.png`;
      await db.exec(`insert into auth.users(id,email,email_confirmed_at) values ('${admin}','admin@example.test',now()),('${sales}','sales@example.test',now());
        insert into public.companies(id,name) values('${ca}','A'),('${cb}','B');
        insert into public.company_members(company_id,user_id,role,can_manage_products) values('${ca}','${admin}','admin',false),('${ca}','${sales}','sales',true),('${cb}','${sales}','sales',false);
        insert into public.products(id,company_id,serial,name,price,image_path) values('${pa}','${ca}','A','A',1,'${live}'),('${pb}','${cb}','B','B',1,'${foreign}');
        insert into storage.objects(bucket_id,name) values('salesgo-products','${live}'),('salesgo-products','${unused}'),('salesgo-products','${foreign}');`);
      async function as(sql) {
        await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"${sales}"}',true);`);
        try { return await db.query(sql); } finally { await db.exec("rollback;"); }
      }
      const upload = `insert into storage.objects(bucket_id,name) values('salesgo-products','${ca}/${pa}/${uid(33)}.webp') returning id`;
      assert.equal((await as(upload)).rows.length,1);
      await assert.rejects(as(`insert into storage.objects(bucket_id,name) values('salesgo-products','${cb}/${pb}/${uid(33)}.webp')`),/row-level security/);
      assert.equal((await as(`delete from storage.objects where name='${live}' returning id`)).rows.length,0);
      assert.equal((await as(`delete from storage.objects where name='${unused}' returning id`)).rows.length,1);
      assert.equal((await as(`delete from storage.objects where name='${foreign}' returning id`)).rows.length,0);
      assert.equal((await as(`update storage.objects set name='overwrite' returning id`)).rows.length,0);
      await db.exec(`update public.company_members set can_manage_products=false where company_id='${ca}' and user_id='${sales}'`);
      await assert.rejects(as(upload),/row-level security/);
      assert.equal((await as(`delete from storage.objects where name='${unused}' returning id`)).rows.length,0);
      assert.equal((await as("select * from storage.objects")).rows.length,3,"revoke only writes, not reads");
      await db.exec(`update public.company_members set can_manage_products=true,active=false where company_id='${ca}' and user_id='${sales}'`);
      await assert.rejects(as(upload),/row-level security/);
      assert.equal((await as(`select * from storage.objects where name like '${ca}/%'`)).rows.length,0);
      assert.equal((await as(`delete from storage.objects where name='${unused}' returning id`)).rows.length,0);
    });
  } finally { await db.close(); }
});
