const { test } = require("node:test"), assert = require("node:assert/strict"), { readFileSync, readdirSync } = require("node:fs"), { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite"), { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
const id = n => `a8000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

test("sign-up WhatsApp seeding: valid numbers stored, invalid ones blank, existing profiles untouched", async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;grant usage on schema auth,storage to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb);alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;`);
    const migrations = readdirSync(join(__dirname, "../supabase/migrations")).filter(f => f.endsWith(".sql")).sort();
    // An account created BEFORE the new migration keeps its profile exactly as it was.
    for (const f of migrations.filter(f => f < "202610070002")) await db.exec(readFileSync(join(__dirname, "../supabase/migrations", f), "utf8"));
    await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values('${id(1)}','old@test.example','{"display_name":"Old","whatsapp":"+60111111111"}')`);
    for (const f of migrations.filter(f => f >= "202610070002")) await db.exec(readFileSync(join(__dirname, "../supabase/migrations", f), "utf8"));
    await db.exec(readFileSync(join(__dirname, "../supabase/tests/register_whatsapp.sql"), "utf8"));

    const old = (await db.query(`select display_name,whatsapp from public.account_profiles where user_id='${id(1)}'`)).rows[0];
    assert.deepEqual(old, { display_name: "Old", whatsapp: "" });

    await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values
      ('${id(2)}','new@test.example','{"display_name":"New","whatsapp":"+60123456789"}'),
      ('${id(3)}','bad@test.example','{"display_name":"Bad","whatsapp":"+6012abc"}'),
      ('${id(4)}','none@test.example','{"display_name":"None"}')`);
    const rows = Object.fromEntries((await db.query(`select user_id,whatsapp from public.account_profiles where user_id in ('${id(2)}','${id(3)}','${id(4)}')`)).rows.map(r => [r.user_id, r.whatsapp]));
    assert.equal(rows[id(2)], "+60123456789");
    assert.equal(rows[id(3)], "");
    assert.equal(rows[id(4)], "");
  } finally { await db.close(); }
});
