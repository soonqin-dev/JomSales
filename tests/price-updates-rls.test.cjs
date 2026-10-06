const {test}=require("node:test"),assert=require("node:assert/strict");
const {readFileSync,readdirSync}=require("node:fs"),{join}=require("node:path");
const {PGlite}=require("@electric-sql/pglite"),{pg_trgm}=require("@electric-sql/pglite/contrib/pg_trgm");
const id=n=>`e0000000-0000-4000-a000-${String(n).padStart(12,"0")}`,json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
test("price update batch 5: real PostgreSQL preview, price-only changes, optimistic guard and retry audit",async t=>{
  const db=new PGlite({extensions:{pg_trgm}}),owner=id(1),sales=id(2),deputy=id(3),other=id(4),co=id(10),foreign=id(11),part=id(20),same=id(21),stale=id(22),gone=id(23),alien=id(24),job=id(40),quote=id(50),photo=`${co}/${part}/${id(30)}.png`;
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
    await db.exec(readFileSync(join(__dirname,"../supabase/tests/launchpad_price_updates.sql"),"utf8"));
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@test.example',now()),('${sales}','sales@test.example',now()),('${deputy}','deputy@test.example',now()),('${other}','other@test.example',now());
      insert into public.companies(id,name) values('${co}','A'),('${foreign}','B');
      insert into public.company_members(company_id,user_id,role,is_primary,can_manage_products) values('${co}','${owner}','admin',true,false),('${co}','${sales}','sales',false,true),('${co}','${deputy}','admin',false,false),('${foreign}','${other}','admin',true,false);
      insert into public.products(id,company_id,serial,name,price,image_path,unit,description,catalog_public) values('${part}','${co}','0000123','Original',3.50,'${photo}','米','Frozen description',true),('${same}','${co}','SAME','Same',9,null,'件','',false),('${stale}','${co}','STALE','Changed',5,null,'件','',false),('${gone}','${co}','GONE','Deleted',7,null,'件','',false),('${alien}','${foreign}','0000123','Other company',66,null,'件','',false);`);
    async function as(user,sql,{commit=false,role=user?"authenticated":"anon"}={}){await db.exec(`begin;set local role ${role};select set_config('request.jwt.claims','${JSON.stringify(user?{sub:user,aal:"aal1"}:{})}',true);`);try{const r=await db.query(sql);await db.exec(commit?"commit":"rollback");return r.rows;}catch(err){await db.exec("rollback");throw err;}}
    const preview=(u,codes)=>as(u,`select public.preview_product_prices('${co}',array[${codes.map(c=>"'"+c+"'").join(",")}]::text[]) value`).then(r=>r[0].value);
    const apply=(u,entries,request=job)=>as(u,`select public.apply_product_prices('${co}','${request}',${json(entries)}) value`,{commit:true}).then(r=>r[0].value);
    const entry=(product_id,serial,old_price,new_price,row_number=1,expected_revision=1)=>({product_id,serial,old_price,new_price,row_number,expected_revision,csv_line:row_number+1});
    let original;
    await t.test("preview no writes, code matching scoped, read-only/admin restrictions and bounded requests",async()=>{
      const rows=await preview(owner,["0000123","same","MISSING"]);assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id===part).price,"3.50");assert(!rows.some(r=>r.id===alien));
      assert.equal((await db.query("select count(*)::int n from public.product_price_jobs")).rows[0].n,0);original=(await db.query(`select * from public.products where id='${part}'`)).rows[0];
      await assert.rejects(preview(sales,["0000123"]),/Administrator/);await assert.rejects(preview(other,["0000123"]),/Administrator/);await assert.rejects(preview(null,["0000123"]),/permission denied/);
      await assert.rejects(apply(sales,[entry(part,"0000123","3.50","4.25")]),/Administrator/);await assert.rejects(apply(other,[entry(part,"0000123","3.50","4.25")]),/Administrator/);await assert.rejects(apply(null,[entry(part,"0000123","3.50","4.25")]),/permission denied/);
      await assert.rejects(preview(owner,Array(501).fill("SAME")),/1-500/);await assert.rejects(apply(owner,Array(101).fill(entry(part,"0000123","3.50","4.25"))),/1-100/);
    });
    await t.test("apply changes only price/revision; saved quote snapshots and total unchanged",async()=>{
      await as(owner,`select public.save_account_profile('Owner Name','',1)`,{commit:true});
      const payload={quote_date:"2026-10-06",customer_name:"Historic",items:[{product:{id:part,serial:"0000123",name:"Original",unit:"米"},quantity:2,unitPrice:3.5}],discount:"0.00"};
      await as(owner,`select public.create_quotation('${co}','${quote}',${json(payload)})`,{commit:true});
      const result=await apply(owner,[entry(part,"0000123","3.50","4.25")]);assert.equal(result[0].status,"updated");assert.equal(result[0].old_price,"3.50");assert.equal(result[0].new_price,"4.25");
      const updated=(await db.query(`select * from public.products where id='${part}'`)).rows[0];assert.equal(updated.price,"4.25");assert.equal(updated.revision,2);
      for(const key of Object.keys(original).filter(k=>!["price","revision","updated_at"].includes(k)))assert.deepEqual(updated[key],original[key],key);
      const q=(await db.query(`select items,total_amount from public.quotations where id='${quote}'`)).rows[0];assert.equal(q.items[0].unitPrice,3.5);assert.equal(q.total_amount,"7.00");
      const audit=(await as(deputy,"select * from public.product_price_changes"))[0];assert.equal(audit.actor,owner);assert.equal(audit.actor_name,"Owner Name");assert.equal(audit.product_name,"Original");assert.equal(audit.before_revision,1);assert.equal(audit.after_revision,2);
    });
    await t.test("lost reply retry replays original result without overwriting newer edits or another admin",async()=>{
      await db.exec(`update public.products set price=8 where id='${part}'`);const replay=await apply(owner,[entry(part,"0000123","3.50","4.25")]);assert.equal(replay[0].replayed,true);assert.equal((await db.query(`select price from public.products where id='${part}'`)).rows[0].price,"8.00");
      const altered=await apply(owner,[entry(part,"0000123","3.50","9.25")]);assert.equal(altered[0].status,"failed");assert.equal((await db.query("select count(*)::int n from public.product_price_changes")).rows[0].n,1);
      await assert.rejects(apply(deputy,[entry(part,"0000123","3.50","4.25")]),/another administrator/);
    });
    await t.test("mixed rows save safe rows, reject stale/deleted/foreign/invalid and record no-op without revision bump",async()=>{
      await db.exec(`update public.products set name='New name' where id='${stale}';update public.products set deleted_at=now() where id='${gone}'`);
      const rows=[entry(same,"same","9.00","9.00",1),entry(stale,"STALE","5.00","6.00",2),entry(gone,"GONE","7.00","8.00",3),entry(alien,"0000123","66.00","0.00",4),entry(same,"SAME","9.00","-1",5),{...entry(same,"SAME","9.00","10.00",6),name:"FORGED"},entry(same,"SAME","9.00","10.00",7)];
      const results=await apply(owner,rows,id(41));assert.deepEqual(results.map(r=>r.status),["unchanged","conflict","unavailable","unavailable","failed","failed","failed"]);
      assert.equal((await db.query(`select revision,price from public.products where id='${same}'`)).rows[0].revision,1);
      assert.equal((await db.query(`select price from public.products where id='${alien}'`)).rows[0].price,"66.00");assert.equal((await db.query(`select count(*)::int n from public.product_price_changes where job_id='${id(41)}'`)).rows[0].n,1);
      const zero=await apply(owner,[entry(same,"SAME","9.00","0.00")],id(42));assert.equal(zero[0].status,"updated");assert.equal(zero[0].new_price,"0.00");
      const forgedOld=await apply(owner,[entry(same,"SAME","9.00","1.00",1,2)],id(43));assert.equal(forgedOld[0].status,"conflict");
    });
    await t.test("history is private and immutable; role revocation and company suspension deny preview and replay",async()=>{
      assert.equal((await as(sales,"select * from public.product_price_changes")).length,0);assert.equal((await as(other,"select * from public.product_price_changes")).length,0);await assert.rejects(as(null,"select * from public.product_price_changes"),/permission denied/);
      await assert.rejects(as(owner,"update public.product_price_changes set new_price=999"),/permission denied/);await assert.rejects(as(owner,"delete from public.product_price_jobs"),/permission denied/);
      await db.exec(`update public.company_members set role='sales' where user_id='${deputy}'`);await assert.rejects(preview(deputy,["SAME"]),/Administrator/);
      await db.exec(`update public.companies set service_state='suspended' where id='${co}'`);await assert.rejects(preview(owner,["SAME"]),/Administrator/);await assert.rejects(apply(owner,[entry(part,"0000123","3.50","4.25")]),/Administrator/);assert.equal((await as(owner,"select * from public.product_price_changes")).length,0);
    });
    await t.test("10,000-product fixture: bounded preview and multi-batch writes with one audit per changed row",async()=>{
      await db.exec(`update public.companies set service_state='active' where id='${co}';insert into public.products(id,company_id,serial,name,price) select ('e0000000-0000-4000-a000-'||lpad((100000+n)::text,12,'0'))::uuid,'${co}','BULK-'||n,'Bulk part',1 from generate_series(1,10000)n;`);
      const first=await preview(owner,Array.from({length:500},(_,i)=>`BULK-${i+1}`));assert.equal(first.length,500);assert.equal((await preview(owner,["BULK-10000"]))[0].serial,"BULK-10000");
      const batch=first.slice(0,100).map((p,i)=>entry(p.id,p.serial,p.price,"2.00",i+1,p.revision));const applied=await apply(owner,batch,id(60));assert.equal(applied.filter(r=>r.status==="updated").length,100);
      const second=first.slice(100,200).map((p,i)=>entry(p.id,p.serial,p.price,"3.00",i+101,p.revision));assert.equal((await apply(owner,second,id(60))).filter(r=>r.status==="updated").length,100);
      assert.equal((await apply(owner,batch,id(60))).filter(r=>r.replayed).length,100);assert.equal((await db.query(`select count(*)::int n from public.product_price_changes where job_id='${id(60)}'`)).rows[0].n,200);
      assert.equal((await preview(owner,["BULK-10000"]))[0].price,"1.00");
    });
  }finally{await db.close();}
});
