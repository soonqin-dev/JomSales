const {test}=require("node:test"),assert=require("node:assert/strict");
const {readFileSync,readdirSync}=require("node:fs"),{join}=require("node:path");
const {PGlite}=require("@electric-sql/pglite"),{pg_trgm}=require("@electric-sql/pglite/contrib/pg_trgm");
const id=n=>`d0000000-0000-4000-a000-${String(n).padStart(12,"0")}`,tok=n=>n.toString(16).padStart(64,"0"),lit=v=>"'"+String(v).replaceAll("'","''")+"'";
test("public catalog batch 4: PostgreSQL price-free capability links, private Storage and permanent revocation",async t=>{
  const db=new PGlite({extensions:{pg_trgm}}),owner=id(1),sales=id(2),peer=id(3),other=id(4),co=id(10),foreign=id(11),part=id(20),hidden=id(21),alien=id(22),photo=`${co}/${part}/${id(40)}.png`,thumb=`${co}/${part}/${id(41)}.png`;
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
      create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      grant usage on schema auth,storage to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb);
      alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;`);
    for(const f of readdirSync(join(__dirname,"../supabase/migrations")).filter(f=>f.endsWith(".sql")).sort())await db.exec(readFileSync(join(__dirname,"../supabase/migrations",f),"utf8"));
    await db.exec(readFileSync(join(__dirname,"../supabase/tests/launchpad_public_catalog.sql"),"utf8"));
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@test.example',now()),('${sales}','sales@test.example',now()),('${peer}','peer@test.example',now()),('${other}','other@test.example',now());
      insert into public.companies(id,name) values('${co}','A'),('${foreign}','B');
      insert into public.company_members(company_id,user_id,role,is_primary,can_manage_products) values('${co}','${owner}','admin',true,false),('${co}','${sales}','sales',false,true),('${co}','${peer}','sales',false,false),('${foreign}','${other}','admin',true,false);
      insert into public.products(id,company_id,serial,name,price,image_path,thumbnail_path,description) values('${part}','${co}','A-1','公开水管',199.93,'${photo}','${thumb}','100%_safe'),('${hidden}','${co}','SECRET','Private part',987.65,null,null,'Internal'),('${alien}','${foreign}','OTHER','Foreign part',66,null,null,'Foreign');
      insert into storage.objects(bucket_id,name) values('salesgo-products','${photo}'),('salesgo-products','${thumb}');`);
    async function as(user,sql,{commit=false,role=user?"authenticated":"anon"}={}){await db.exec(`begin;set local role ${role};select set_config('request.jwt.claims','${JSON.stringify(user?{sub:user,aal:"aal1"}:{})}',true);`);try{const r=await db.query(sql);await db.exec(commit?"commit":"rollback");return r.rows;}catch(err){await db.exec("rollback");throw err;}}
    const create=(user,n,selection="null",label="Test")=>as(user,`select * from public.create_catalog_link('${co}','${id(n)}','${tok(n)}',${lit(label)},${selection})`,{commit:true}).then(r=>r[0]);
    const page=(token,q="",cursor=null)=>as(null,`select public.read_public_catalog(${lit(token)},${lit(q)},${cursor?lit(cursor.created_at):"null"},${cursor?lit(cursor.id):"null"}) as value`).then(r=>r[0].value);
    const visibility=(user,p,rev,on)=>as(user,`select public.set_product_catalog_visibility('${co}','${p}',${rev},${on}) as result`,{commit:true}).then(r=>r[0].result);
    await t.test("private by default; admin-only visibility separate from staff product CRUD",async()=>{
      assert.equal((await db.query("select count(*)::int n from public.products where catalog_public")).rows[0].n,0);
      await assert.rejects(as(sales,`update public.products set catalog_public=true where id='${part}'`),/permission denied/);
      await assert.rejects(visibility(sales,part,1,true),/Administrator/);
      await assert.rejects(visibility(other,part,1,true),/Administrator/);
      const p=await visibility(owner,part,1,true);assert.equal(p.catalog_public,true);assert.equal(p.revision,2);
      await assert.rejects(visibility(owner,part,1,false),/Product changed/);
      await assert.rejects(create(sales,100),/work WhatsApp/);
      await as(sales,`select public.save_account_profile('Sales Name','+60123456789',1)`,{commit:true});
      await as(peer,`select public.save_account_profile('Peer','+60199887766',1)`,{commit:true});
    });
    let full,selected;
    await t.test("fixed seven days, stable retry, private link list and selected validation",async()=>{
      full=await create(sales,100);assert.equal(Date.parse(full.expires_at)-Date.parse(full.created_at),7*86400000);
      assert.equal((await create(sales,100)).expires_at.getTime(),full.expires_at.getTime());
      await assert.rejects(create(sales,100,"null","Different"),/different contents/);
      selected=await create(peer,101,`array['${part}']::uuid[]`);
      await assert.rejects(create(sales,102,`array['${hidden}']::uuid[]`),/not public/);
      await assert.rejects(create(sales,103,`array['${alien}']::uuid[]`),/not public/);
      await assert.rejects(create(sales,104,"'{}'::uuid[]"),/1-1000/);
      assert.equal((await as(sales,"select * from public.catalog_links")).length,1);assert.equal((await as(owner,"select * from public.catalog_links")).length,2);assert.equal((await as(other,"select * from public.catalog_links")).length,0);
      await assert.rejects(as(null,"select * from public.catalog_links"),/permission denied/);
      await assert.rejects(as(null,"select * from public.products"),/permission denied/);
      assert.equal((await as(null,"select * from storage.objects")).length,0);
      await assert.rejects(as(sales,"update public.catalog_links set expires_at=now()+interval '1 year'"),/permission denied/);
    });
    await t.test("anonymous APIs omit all prices, internal paths and identities; literal search and photo/inquiry scope",async()=>{
      const result=await page(tok(100));assert.equal(result.total,1);assert.equal(result.seller_name,"Sales Name");assert.equal(result.whatsapp,"+60123456789");
      const text=JSON.stringify(result);for(const forbidden of ['price','199.93','987.65','image_path','thumbnail_path','source_key','created_by','company_id','creator_email'])assert(!text.includes(forbidden),forbidden);
      assert.equal((await page(tok(100),"100%_safe")).total,1);assert.equal((await page(tok(100),"SECRET")).total,0);assert.equal((await page(tok(101))).items.length,1);
      assert.equal((await as(null,`select public.public_catalog_image('${tok(100)}','${part}') value`))[0].value,thumb);
      assert.equal((await as(null,`select public.public_catalog_image('${tok(100)}','${part}',true) value`))[0].value,photo);
      const contact=(await as(null,`select public.public_catalog_inquiry('${tok(100)}','${part}') value`))[0].value;assert.deepEqual(contact,{whatsapp:"+60123456789",serial:"A-1",name:"公开水管"});
      await assert.rejects(as(null,`select public.public_catalog_image('${tok(100)}','${alien}')`),/unavailable/);
      await assert.rejects(as(null,`select public.public_catalog_inquiry('${tok(100)}','${hidden}')`),/unavailable/);
      await assert.rejects(page(tok(999)),/unavailable/);await assert.rejects(page("bad"),/unavailable/);
      await assert.rejects(as(null,`select public.jomsales_live_catalog('${tok(100)}')`),/permission denied/);
      await assert.rejects(as(null,`select public.create_catalog_link('${co}','${id(999)}','${tok(999)}','',null)`),/permission denied/);
    });
    await t.test("50-item keyset paging, whole allowed catalog follows public products and chosen link stays a subset",async()=>{
      await db.exec(`insert into public.products(id,company_id,serial,name,price,catalog_public,created_at) select ('d0000000-0000-4000-a000-'||lpad((1000+n)::text,12,'0'))::uuid,'${co}','B-'||n,'Part '||n,777,true,'2026-01-01' from generate_series(1,120)n;`);
      const seen=new Set();let cursor=null,more=true;while(more){const p=await page(tok(100),"",cursor);assert.equal(p.total,121);assert(p.items.length<=50);for(const item of p.items){assert(!seen.has(item.id));seen.add(item.id);}cursor=p.cursor;more=p.has_more;}
      assert.equal(seen.size,121);assert.equal((await page(tok(101))).total,1);
      const internal=(await as(peer,`select public.search_catalog_share_products('${co}','B-') value`))[0].value;assert.equal(internal.items.length,50);assert.equal(internal.has_more,true);
      const p=await visibility(owner,part,2,false);assert.equal((await page(tok(101))).total,0);await assert.rejects(as(null,`select public.public_catalog_inquiry('${tok(101)}','${part}')`),/unavailable/);await visibility(owner,part,p.revision,true);
    });
    await t.test("bulk publication is admin-only, count-guarded, literal and never changes prices",async()=>{
      const bulk=(u,search,count,on)=>as(u,`select public.set_catalog_visibility_batch('${co}',${lit(search)},${count},${on}) changed`,{commit:true});
      await assert.rejects(bulk(sales,"B-",120,false),/Administrator/);await assert.rejects(bulk(owner,"B-",119,false),/changed/);
      assert.equal((await bulk(owner,"B-",120,false))[0].changed,120);assert.equal((await page(tok(100))).total,1);assert.equal((await page(tok(101))).total,1);
      assert.equal((await db.query("select min(price)::text p from public.products where serial like 'B-%'")).rows[0].p,"777.00");
      assert.equal((await bulk(owner,"B-",120,true))[0].changed,120);assert.equal((await page(tok(100))).total,121);
      await assert.rejects(bulk(owner,"B-",10001,false),/1-10000/);
      assert.equal((await bulk(owner,"100%_safe",1,false))[0].changed,1);assert.equal((await page(tok(100))).total,120);
      await bulk(owner,"100%_safe",1,true);
    });
    await t.test("owner/admin revoke; no cross-owner mutation and expiry cannot be bypassed",async()=>{
      await assert.rejects(as(peer,`select public.revoke_catalog_link('${co}','${id(100)}')`,{commit:true}),/unavailable/);
      await as(owner,`select public.revoke_catalog_link('${co}','${id(101)}')`,{commit:true});await assert.rejects(page(tok(101)),/unavailable/);
      await create(sales,105);await db.exec(`update public.catalog_links set created_at=created_at-interval '8 days',expires_at=expires_at-interval '8 days' where id='${id(105)}'`);await assert.rejects(page(tok(105)),/unavailable/);
      await as(sales,`select public.revoke_catalog_link('${co}','${id(100)}')`,{commit:true});await assert.rejects(page(tok(100)),/unavailable/);
      assert((await create(sales,100)).revoked_at,"retry must not re-enable or extend a revoked link");
    });
    await t.test("disable/restore, removal/rejoin and phone change never revive old links",async()=>{
      await create(sales,106);await as(owner,`select public.manage_company_member('${co}','${sales}','disable')`,{commit:true});await assert.rejects(page(tok(106)),/unavailable/);
      await as(owner,`select public.manage_company_member('${co}','${sales}','enable')`,{commit:true});await assert.rejects(page(tok(106)),/unavailable/);
      await create(sales,107);await as(owner,`select public.manage_company_member('${co}','${sales}','remove')`,{commit:true});await assert.rejects(page(tok(107)),/unavailable/);
      await db.exec(`update public.company_members set active=true,removed_at=null where company_id='${co}' and user_id='${sales}'`);await assert.rejects(page(tok(107)),/unavailable/);
      await create(sales,108);await as(sales,`select public.save_account_profile('Sales Name','+60123456780',2)`,{commit:true});await assert.rejects(page(tok(108)),/unavailable/);
      await as(sales,`select public.save_account_profile('Sales Name','+60123456789',3)`,{commit:true});await assert.rejects(page(tok(108)),/unavailable/);
    });
    await t.test("company suspension/restoration and automatic service expiry permanently invalidate links",async()=>{
      await create(sales,109);await db.exec(`update public.companies set service_state='suspended' where id='${co}'`);await assert.rejects(page(tok(109)),/unavailable/);
      await db.exec(`update public.companies set service_state='active' where id='${co}'`);await assert.rejects(page(tok(109)),/unavailable/);
      await create(sales,110);await db.exec(`update public.companies set service_until=now()-interval '1 hour' where id='${co}';update public.catalog_links set revoked_at=null where id='${id(110)}'`);
      await assert.rejects(page(tok(110)),/unavailable/);await db.exec(`update public.companies set service_until=now()+interval '1 month' where id='${co}'`);await assert.rejects(page(tok(110)),/unavailable/);
      await create(sales,111);assert.equal((await page(tok(111))).total,121);
      await db.exec(`update public.products set deleted_at=now() where id='${part}'`);assert.equal((await page(tok(111))).total,120);await assert.rejects(as(null,`select public.public_catalog_image('${tok(111)}','${part}')`),/unavailable/);
    });
  }finally{await db.close();}
});
