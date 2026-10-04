const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

test("employee invitation SQL runs unmodified in PostgreSQL and rolls back all fixtures", async () => {
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
    for (const file of ["202610030001_company_accounts.sql", "202610040001_cloud_products.sql", "202610040002_employee_invitations.sql"]) {
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
  } finally { await db.close(); }
});
