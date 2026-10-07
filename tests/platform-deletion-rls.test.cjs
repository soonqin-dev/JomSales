const { test } = require("node:test"), assert = require("node:assert/strict"), { readFileSync, readdirSync } = require("node:fs"), { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite"), { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
const id = n => `a9000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

test("platform recycle bin: companies and accounts, restore, forced and expired purge", async t => {
  const db = new PGlite({ extensions: { pg_trgm } });
  const platform = id(1), owner = id(2), sales = id(3), peer = id(4), outsider = id(5), co = id(10), other = id(11);
  try {
    // Auth stub mirrors the Supabase columns the migration touches (unique e-mail, banned_until).
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
      create table auth.users(id uuid primary key,aud text,role text,email text unique,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),banned_until timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      grant usage on schema auth,storage to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb);
      alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;`);
    for (const f of readdirSync(join(__dirname, "../supabase/migrations")).filter(f => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(__dirname, "../supabase/migrations", f), "utf8"));
    await db.exec(readFileSync(join(__dirname, "../supabase/tests/platform_deletion.sql"), "utf8"));
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${platform}','platform@test.example',now()),('${owner}','owner@test.example',now()),
        ('${sales}','sales@test.example',now()),('${peer}','peer@test.example',now()),('${outsider}','outsider@test.example',now());
      insert into public.platform_admins(user_id) values('${platform}');
      insert into public.companies(id,name) values('${co}','Doomed Sdn Bhd'),('${other}','Other Co');
      insert into public.company_entitlements(company_id) values('${co}'),('${other}') on conflict do nothing;
      insert into public.company_members(company_id,user_id,role,is_primary) values('${co}','${owner}','admin',true),('${co}','${sales}','sales',false),('${co}','${peer}','sales',false),('${other}','${outsider}','admin',true);
      insert into public.products(id,company_id,serial,name,price) values('${id(20)}','${co}','P-1','Widget',9),('${id(21)}','${other}','O-1','Keep me',5);
      insert into public.customers(company_id,created_by,name) values('${co}','${sales}','Ali');
      insert into public.quotations(id,company_id,created_by,number,quote_date,customer_name,status) values('${id(30)}','${co}','${sales}','Q-1','2026-10-01','Ali','pending'),('${id(31)}','${other}','${outsider}','O-1','2026-10-01','Keep','pending');
      insert into storage.buckets(id,name) values('salesgo-products','salesgo-products'),('salesgo-branding','salesgo-branding') on conflict do nothing;
      insert into storage.objects(bucket_id,name,metadata) values('salesgo-products','${co}/${id(20)}/a.webp','{"size":100}'),('salesgo-products','${other}/${id(21)}/b.webp','{"size":50}');`);
    async function as(user, sql, aal = "aal1") {
      await db.exec(`begin;set local role ${user ? "authenticated" : "anon"};select set_config('request.jwt.claims','${JSON.stringify(user ? { sub: user, aal } : {})}',true);`);
      try { const result = await db.query(sql); await db.exec("commit"); return result.rows; } catch (err) { await db.exec("rollback"); throw err; }
    }
    const visible = async user => (await as(user, `select company_id from public.company_members`)).length;

    await t.test("only the platform owner can delete, with the exact company name", async () => {
      await assert.rejects(as(owner, `select public.platform_trash_company('${co}','Doomed Sdn Bhd')`), /Platform administrator/);
      await assert.rejects(as(platform, `select public.platform_trash_company('${co}','doomed')`), /name does not match/);
      await db.exec(`update public.platform_admins set require_mfa=true`);
      await assert.rejects(as(platform, `select public.platform_trash_company('${co}','Doomed Sdn Bhd')`), /Platform administrator/);
      await db.exec(`update public.platform_admins set require_mfa=false`);
    });

    await t.test("export pages include every quotation, customer and product of the company only", async () => {
      const quotes = (await as(platform, `select public.platform_company_export('${co}','quotations',0) v`))[0].v;
      assert.deepEqual(quotes.map(q => q.number), ["Q-1"]);
      assert.equal((await as(platform, `select public.platform_company_export('${co}','customers',0) v`))[0].v[0].name, "Ali");
      assert.equal((await as(platform, `select public.platform_company_export('${co}','products',0) v`))[0].v.length, 1);
      await assert.rejects(as(sales, `select public.platform_company_export('${co}','quotations',0)`), /Platform administrator/);
    });

    await t.test("recycle bin blocks every member; restore brings access back", async () => {
      assert.equal(await visible(sales), 1);
      await as(platform, `select public.platform_trash_company('${co}','Doomed Sdn Bhd')`);
      assert.equal(await visible(sales), 0);
      assert.equal(await visible(owner), 0);
      assert.equal(await visible(outsider), 1);
      assert.equal((await as(platform, `select * from public.platform_list_companies('',0,'trash')`)).length, 1);
      assert.equal((await as(platform, `select * from public.platform_list_companies('',0)`)).length, 1);
      assert.deepEqual((await as(platform, `select name from public.platform_company_files('${co}')`)).map(r => r.name), [`${co}/${id(20)}/a.webp`]);
      await as(platform, `select public.platform_restore_company('${co}')`);
      assert.equal(await visible(sales), 1);
    });

    await t.test("account rules: platform owner and primary admins are protected", async () => {
      await assert.rejects(as(platform, `select public.platform_trash_account('${platform}','platform@test.example')`), /Platform owner/);
      await assert.rejects(as(platform, `select public.platform_trash_account('${owner}','owner@test.example')`), /primary administrator/);
      await assert.rejects(as(platform, `select public.platform_trash_account('${sales}','wrong@test.example')`), /does not match/);
    });

    await t.test("deleted account: blocked everywhere, cannot be re-enabled, restorable", async () => {
      await as(platform, `select public.platform_trash_account('${sales}','SALES@test.example')`);
      assert.equal(await visible(sales), 0);
      const [profile] = (await db.query(`select deleted_at,login_blocked from public.account_profiles where user_id='${sales}'`)).rows;
      assert(profile.deleted_at); assert.equal(profile.login_blocked, true);
      assert((await db.query(`select banned_until from auth.users where id='${sales}'`)).rows[0].banned_until);
      await assert.rejects(db.exec(`update public.company_members set active=true where user_id='${sales}'`), /account has been deleted/);
      await assert.rejects(as(sales, `select public.save_account_profile('X','',1)`), /deleted|changed/);
      await as(platform, `select public.platform_restore_account('${sales}')`);
      assert.equal((await db.query(`select banned_until from auth.users where id='${sales}'`)).rows[0].banned_until, null);
      await db.exec(`update public.company_members set active=true where user_id='${sales}'`);
      assert.equal(await visible(sales), 1);
    });

    await t.test("account purge clears the profile, keeps the shell and frees the e-mail", async () => {
      await as(platform, `select public.platform_trash_account('${peer}','peer@test.example')`);
      const result = (await as(platform, `select public.platform_purge_account('${peer}','peer@test.example') v`))[0].v;
      assert.equal(result.email_released, true);
      const [shell] = (await db.query(`select display_name,whatsapp,purged_at,email_hash from public.account_profiles where user_id='${peer}'`)).rows;
      assert.equal(shell.display_name, ""); assert.equal(shell.whatsapp, ""); assert(shell.purged_at); assert.equal(shell.email_hash.length, 64);
      assert.equal((await db.query(`select email from auth.users where id='${peer}'`)).rows[0].email, `deleted-${peer}@jomsales.invalid`);
      await db.exec(`insert into auth.users(id,email) values('${id(6)}','peer@test.example')`);
      assert.equal((await as(platform, `select * from public.platform_list_accounts('',0,'purged')`)).length, 1);
      await assert.rejects(as(platform, `select public.platform_restore_account('${peer}')`), /not in the recycle bin/);
    });

    await t.test("forced company purge removes business rows, keeps a tombstone and the audit", async () => {
      await as(platform, `select public.platform_trash_company('${co}','Doomed Sdn Bhd')`);
      await assert.rejects(as(platform, `select public.platform_purge_company('${co}','nope')`), /name does not match/);
      const counts = (await as(platform, `select public.platform_purge_company('${co}','Doomed Sdn Bhd') v`))[0].v;
      assert.equal(counts.quotations, 1); assert.equal(counts.products, 1);
      for (const table of ["quotations", "products", "customers", "company_members"]) assert.equal((await db.query(`select count(*)::int n from public.${table} where company_id='${co}'`)).rows[0].n, 0, table);
      assert.equal((await db.query(`select count(*)::int n from public.quotations where company_id='${other}'`)).rows[0].n, 1);
      const [tomb] = (await db.query(`select name,purged_at from public.companies where id='${co}'`)).rows;
      assert.equal(tomb.name, "Doomed Sdn Bhd"); assert(tomb.purged_at);
      assert((await db.query(`select action from public.platform_audit where company_id='${co}'`)).rows.some(r => r.action === "company.purge.forced"));
      await assert.rejects(as(platform, `select public.platform_restore_company('${co}')`), /not in the recycle bin/);
      // Accounts are never deleted with a company: the owner can still sign in and be invited elsewhere.
      assert.equal((await db.query(`select count(*)::int n from auth.users where id='${owner}'`)).rows[0].n, 1);
    });

    await t.test("expired items are purged by the hourly job only after 30 days", async () => {
      await as(platform, `select public.platform_trash_company('${other}','Other Co')`);
      await as(platform, `select public.platform_trash_account('${sales}','sales@test.example')`);
      let run = (await db.query(`select public.purge_expired_platform_deletions() v`)).rows[0].v;
      assert.deepEqual(run, { companies: 0, accounts: 0 });
      await db.exec(`update public.companies set purge_after=now()-interval '1 minute' where id='${other}';update public.account_profiles set purge_after=now()-interval '1 minute' where user_id='${sales}'`);
      run = (await db.query(`select public.purge_expired_platform_deletions() v`)).rows[0].v;
      assert.deepEqual(run, { companies: 1, accounts: 1 });
      assert.equal((await db.query(`select count(*)::int n from public.products where company_id='${other}'`)).rows[0].n, 0);
      await assert.rejects(as(platform, `select public.purge_expired_platform_deletions()`), /permission denied/);
    });
  } finally { await db.close(); }
});
