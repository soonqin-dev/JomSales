const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { pg_trgm } = require("@electric-sql/pglite/contrib/pg_trgm");
const id=n=>`a0000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
test("catalog batch 2: PostgreSQL search, numbering, CSV, thumbnail RLS and decimal snapshots",async t=>{
  const db=new PGlite({extensions:{pg_trgm}}),owner=id(1),sales=id(2),other=id(3),co=id(10),foreign=id(11),part=id(20);
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
      create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      grant usage on schema auth,storage to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb);
      alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;`);
    for(const file of readdirSync(join(__dirname,"../supabase/migrations")).filter(f=>f.endsWith(".sql")).sort())await db.exec(readFileSync(join(__dirname,"../supabase/migrations",file),"utf8"));
    await db.exec(readFileSync(join(__dirname,"../supabase/tests/launchpad_catalog.sql"),"utf8"));
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@test.example',now()),('${sales}','sales@test.example',now()),('${other}','other@test.example',now());
      insert into public.companies(id,name) values('${co}','A'),('${foreign}','B');
      insert into public.company_members(company_id,user_id,role,is_primary) values('${co}','${owner}','admin',true),('${co}','${sales}','sales',false),('${foreign}','${other}','admin',true);
      insert into public.company_entitlements(company_id) values('${co}'),('${foreign}');
      insert into public.products(id,company_id,serial,name,price,description) values('${part}','${co}','P-00001','电线',3.50,'100%_safe'),('${id(21)}','${foreign}','B-1','Foreign',5,'Secret');`);
    async function as(user,sql,{commit=false,role="authenticated"}={}){
      await db.exec(`begin;set local role ${role};select set_config('request.jwt.claims','${JSON.stringify(user?{sub:user,aal:"aal1"}:{})}',true);`);
      try{const result=await db.query(sql);await db.exec(commit?"commit":"rollback");return result.rows;}catch(err){await db.exec("rollback");throw err;}
    }
    const page=(user,query="",cursor=null)=>as(user,`select public.search_company_products('${co}','${query.replaceAll("'","''")}',${cursor?"'"+cursor.created_at+"'":"null"},${cursor?"'"+cursor.id+"'":"null"}) as result`).then(rows=>rows[0].result);
    await t.test("global cloud search is scoped and wildcard characters literal",async()=>{
      assert.equal((await page(sales,"电线")).items[0].serial,"P-00001");
      assert.equal((await page(sales,"100%_safe")).total,1);
      assert.equal((await page(sales,"Secret")).total,0);
      await assert.rejects(page(other),/access denied/);
      await assert.rejects(as(null,`select public.search_company_products('${co}')`,{role:"anon"}),/permission denied/);
    });
    await t.test("number reservations retry by stable product id, skip collisions and protect pending codes",async()=>{
      await as(owner,`select public.get_product_number_settings('${co}')`,{commit:true});
      const first=(await as(owner,`select public.reserve_product_number('${co}','${id(30)}') as serial`,{commit:true}))[0].serial;
      assert.equal(first,"P-00002");assert.equal((await as(owner,`select public.reserve_product_number('${co}','${id(30)}') as serial`))[0].serial,first);
      assert.equal((await as(owner,`select public.reserve_product_number('${co}','${id(31)}') as serial`,{commit:true}))[0].serial,"P-00003");
      await assert.rejects(as(owner,`insert into public.products(company_id,serial,name,price) values('${co}','${first}','Steal',1)`),/reserved/);
      await assert.rejects(as(owner,`update public.products set serial='${first}' where id='${part}'`),/reserved/);
      await assert.rejects(as(sales,`select public.reserve_product_number('${co}','${id(32)}')`),/permission required/);
      const settings=(await as(owner,`select (public.get_product_number_settings('${co}')).*`))[0];
      await assert.rejects(as(owner,`select public.save_product_number_settings('${co}',${settings.revision-1},true,'HW-',6,100)`),/changed/);
      await as(owner,`select public.save_product_number_settings('${co}',${settings.revision},true,'HW-',6,100)`,{commit:true});
      assert.equal((await as(owner,`select public.reserve_product_number('${co}','${id(33)}') as serial`))[0].serial,"HW-000100");
      assert.equal((await db.query(`select serial from public.products where id='${part}'`)).rows[0].serial,"P-00001","old product not renumbered");
    });
    await t.test("CSV admin-only, partially validates rows and replays committed rows without duplication",async()=>{
      const entries=[{row_number:1,serial:"00008",name:"工具",price:"12.50",unit:"盒",tags:["五金"],category:"Tools",description:"规格",is_service:false},
        {row_number:2,serial:"P-00001",name:"Do not overwrite",price:"0"},{row_number:3,serial:"BAD",name:"Bad",price:"-1"},
        {row_number:4,serial:"SV-1",name:"安装人工",price:"80",unit:"小时",is_service:true}];
      const sql=`select public.import_products_batch('${co}','${id(40)}',${literal(entries)}) as result`;
      await assert.rejects(as(sales,sql),/Administrator/);await assert.rejects(as(other,sql),/Administrator/);
      const results=(await as(owner,sql,{commit:true}))[0].result;
      assert.deepEqual(results.map(row=>row.status),["imported","duplicate","failed","imported"]);
      const retry=(await as(owner,sql,{commit:true}))[0].result;assert(retry[0].replayed);assert(retry[3].replayed);
      assert.equal((await db.query(`select count(*)::int as n from public.products where company_id='${co}' and serial='00008'`)).rows[0].n,1);
      assert.equal((await db.query(`select name from public.products where id='${part}'`)).rows[0].name,"电线");
      entries[0].price="13";assert.equal((await as(owner,`select public.import_products_batch('${co}','${id(40)}',${literal(entries)}) as result`))[0].result[0].status,"failed");
      const codes=(await as(owner,`select public.check_product_import_codes('${co}',array['00008','p-00001','OTHER']) as codes`))[0].codes;
      assert.deepEqual(codes.sort(),["00008","p-00001"]);
      await assert.rejects(as(sales,`select public.check_product_import_codes('${co}',array['00008'])`),/Administrator/);
      await assert.rejects(as(owner,`insert into public.product_import_rows values('${co}','${id(41)}',1,'fake','${part}',now())`),/permission denied/);
    });
    await t.test("direct product quota, suspension and revoked write permissions cannot be bypassed",async()=>{
      const count=(await db.query(`select count(*)::int as n from public.products where company_id='${co}' and deleted_at is null`)).rows[0].n;
      await db.exec(`update public.company_entitlements set product_limit=${count} where company_id='${co}'`);
      await assert.rejects(as(owner,`insert into public.products(company_id,serial,name,price) values('${co}','LIMIT','Limit',1)`),/quota/);
      assert.equal((await as(owner,`update public.products set name='电线 updated' where id='${part}' returning id`)).length,1,"edits allowed above cap");
      await db.exec(`update public.company_entitlements set product_limit=null where company_id='${co}';update public.company_members set can_manage_products=true where user_id='${sales}'`);
      assert.equal((await as(sales,`insert into public.products(company_id,serial,name,price,unit,is_service) values('${co}','SERVICE','人工',1,'小时',true) returning id`)).length,1);
      await assert.rejects(as(sales,`select public.import_products_batch('${co}','${id(42)}','[{"row_number":1,"serial":"S","name":"S","price":"1"}]')`),/Administrator/);
      await db.exec(`update public.companies set service_state='suspended' where id='${co}'`);
      await assert.rejects(page(owner),/access denied/);
      await assert.rejects(as(owner,`select public.reserve_product_number('${co}','${id(43)}')`),/permission required/);
      await assert.rejects(as(owner,`select public.import_products_batch('${co}','${id(44)}','[{"row_number":1,"serial":"S","name":"S","price":"1"}]')`),/Administrator/);
      await db.exec(`update public.companies set service_state='active' where id='${co}'`);
    });
    await t.test("live thumbnail and original cannot be cleaned, unused objects can",async()=>{
      const original=`${co}/${part}/${id(50)}.png`,thumb=`${co}/${part}/${id(51)}.png`,unused=`${co}/${part}/${id(52)}.png`;
      await db.exec(`update public.products set image_path='${original}',thumbnail_path='${thumb}' where id='${part}';insert into storage.objects(bucket_id,name) values('salesgo-products','${original}'),('salesgo-products','${thumb}'),('salesgo-products','${unused}')`);
      for(const path of [original,thumb])assert.equal((await as(owner,`delete from storage.objects where name='${path}' returning id`)).length,0);
      assert.equal((await as(owner,`delete from storage.objects where name='${unused}' returning id`)).length,1);
    });
    await t.test("SQL decimal rounding matches line-level cents and preserves optional snapshots",async()=>{
      const lines=[{product:{id:part,serial:"P-00001",name:"电线",unit:"米",description:"规格",is_service:false},quantity:1.005,unitPrice:1}];
      assert.equal(Number((await as(owner,`select public.quote_subtotal_cents(${literal(lines)}) as cents`))[0].cents),101);
      const tiny=[...lines.map(line=>({...line,quantity:0.5,unitPrice:0.01})),...lines.map(line=>({...line,quantity:0.5,unitPrice:0.01}))];
      assert.equal(Number((await as(owner,`select public.quote_subtotal_cents(${literal(tiny)}) as cents`))[0].cents),2);
      await as(sales,`insert into public.quotations(company_id,number,quote_date,items) values('${co}','DECIMAL',current_date,${literal(lines)})`,{commit:true});
      await db.exec(`update public.products set unit='盒',description='New specification' where id='${part}'`);
      const snapshot=(await db.query(`select items from public.quotations where number='DECIMAL'`)).rows[0].items[0].product;
      assert.equal(snapshot.unit,"米");assert.equal(snapshot.description,"规格");
      lines[0].quantity=0.0001;await assert.rejects(as(owner,`select public.quote_subtotal_cents(${literal(lines)})`),/Invalid quotation quantity/);
    });
    await t.test("10,000-product real SQL fixture: one-page bound, search beyond first page and all keyset pages unique",async()=>{
      await db.exec(`insert into public.products(company_id,serial,name,price,created_at)
        select '${co}', 'BULK-'||lpad(n::text,5,'0'),'Batch product '||n,1,'2026-01-01'::timestamptz from generate_series(1,10000) n`);
      const first=await page(sales,"Batch product");assert.equal(first.items.length,50);assert.equal(first.total,10000);assert(first.has_more);
      assert.equal((await page(sales,"BULK-10000")).items[0].serial,"BULK-10000");
      const seen=new Set(first.items.map(row=>row.id));let cursor=first.cursor,more=first.has_more,pages=1;
      while(more){const next=await page(sales,"Batch product",cursor);assert(next.items.length<=50);for(const row of next.items){assert(!seen.has(row.id));seen.add(row.id);}cursor=next.cursor;more=next.has_more;pages++;}
      assert.equal(seen.size,10000);assert.equal(pages,200);
    });
  }finally{await db.close();}
});
