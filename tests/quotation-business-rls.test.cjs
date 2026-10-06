const {test}=require("node:test"),assert=require("node:assert/strict");
const {readFileSync,readdirSync}=require("node:fs"),{join}=require("node:path");
const {PGlite}=require("@electric-sql/pglite"),{pg_trgm}=require("@electric-sql/pglite/contrib/pg_trgm");
const id=n=>`c0000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
const json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
test("quotation batch 3: private customers, cloud numbers, snapshots, Paid audit and report",async t=>{
  const db=new PGlite({extensions:{pg_trgm}}),admin=id(1),sales=id(2),peer=id(3),other=id(4),co=id(10),foreign=id(11),customer=id(20),peerCustomer=id(21),alien=id(22),q1=id(30),q2=id(31),old=id(32);
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
      create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
      grant usage on schema auth,storage to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb);
      alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;`);
    for(const file of readdirSync(join(__dirname,"../supabase/migrations")).filter(f=>f.endsWith(".sql")).sort()){
      if(file.startsWith("202610060003"))await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${admin}','admin@test.example',now()),('${sales}','sales@test.example',now()),('${peer}','peer@test.example',now()),('${other}','other@test.example',now());
        insert into public.companies(id,name) values('${co}','A'),('${foreign}','B');
        insert into public.company_members(company_id,user_id,role,is_primary) values('${co}','${admin}','admin',true),('${co}','${sales}','sales',false),('${co}','${peer}','sales',false),('${foreign}','${other}','admin',true);
        insert into public.quotations(id,company_id,created_by,number,quote_date,customer_name,status) values('${old}','${co}','${sales}','OLD',current_date,'Historic','success');`);
      await db.exec(readFileSync(join(__dirname,"../supabase/migrations",file),"utf8"));
    }
    await db.exec(readFileSync(join(__dirname,"../supabase/tests/launchpad_quotations.sql"),"utf8"));
    async function as(user,sql,{commit=false,role="authenticated"}={}){await db.exec(`begin;set local role ${role};select set_config('request.jwt.claims','${JSON.stringify(user?{sub:user,aal:"aal1"}:{})}',true);`);try{const result=await db.query(sql);await db.exec(commit?"commit":"rollback");return result.rows;}catch(err){await db.exec("rollback");throw err;}}
    const payload=()=>({quote_date:"2026-10-06",customer_name:"Frozen customer",customer_phone:"123",customer_company:"Client Ltd",customer_email:"client@test.example",customer_address:"Old address",customer_id:customer,notes:"Old notes",payment_terms:"Deposit",validity_days:14,discount:"5.00",items:[
      {product:{id:"catalog-wire",serial:"WIRE",name:"Wire",unit:"米",description:"Old spec",is_service:false},quantity:2.5,unitPrice:3.5},
      {product:{id:"temp-job",serial:"临时项目",name:"Labour",unit:"小时",is_service:true,temporary:true},quantity:1.25,unitPrice:60}]});
    const create=(user,idValue,data)=>as(user,`select * from public.create_quotation('${co}','${idValue}',${json(data)})`,{commit:true}).then(rows=>rows[0]);
    await t.test("legacy quotes unchanged; default settings admin-only with revision guard",async()=>{
      const original=(await db.query(`select * from public.quotations where id='${old}'`)).rows[0];assert.equal(original.number,"OLD");assert.equal(original.confirmed_at,null);assert.equal(original.validity_days,null);
      await assert.rejects(as(sales,`select public.save_quotation_defaults('${co}',1,'JB',5,30,'Deposit','Terms')`),/Administrator/);
      await as(admin,`select public.save_quotation_defaults('${co}',1,'JB',5,30,'Deposit','Terms')`,{commit:true});
      await assert.rejects(as(admin,`select public.save_quotation_defaults('${co}',1,'STALE',5,30,'','')`),/changed/);
      assert.equal((await as(sales,`select public.get_quotation_defaults('${co}') as settings`))[0].settings.prefix,"JB");
    });
    await t.test("private customers; admin sees but cannot change another employee's contacts",async()=>{
      await as(sales,`insert into public.customers(id,company_id,name,email) values('${customer}','${co}','Own client','client@test.example')`,{commit:true});
      await as(peer,`insert into public.customers(id,company_id,name) values('${peerCustomer}','${co}','Peer client')`,{commit:true});
      await as(other,`insert into public.customers(id,company_id,name) values('${alien}','${foreign}','Alien')`,{commit:true});
      assert.equal((await as(sales,"select * from public.customers")).length,1);assert.equal((await as(admin,"select * from public.customers")).length,2);
      assert.equal((await as(admin,`update public.customers set name='Override' where id='${customer}' returning id`)).length,0);
      await assert.rejects(as(sales,`update public.customers set created_by='${peer}' where id='${customer}'`),/permission denied/);
      await assert.rejects(as(sales,`insert into public.customers(company_id,name) values('${foreign}','Foreign')`),/row-level security/);
      await assert.rejects(as(null,"select * from public.customers",{role:"anon"}),/permission denied/);
    });
    let saved;
    await t.test("new quotes cloud-numbered, idempotent, ownership-safe with optional temporary services",async()=>{
      saved=await create(sales,q1,payload());assert.equal(saved.number,"JB-2026-00001");assert.equal(Number(saved.total_amount),78.75);
      assert.equal((await create(sales,q1,payload())).number,saved.number);
      const second=await create(peer,q2,{...payload(),customer_id:peerCustomer});assert.equal(second.number,"JB-2026-00002");
      await assert.rejects(create(peer,id(35),payload()),/Customer access denied/);
      await assert.rejects(create(sales,id(36),{...payload(),customer_id:alien}),/Customer access denied/);
      await assert.rejects(create(sales,q1,{...payload(),notes:"Changed request"}),/already used/);
      await assert.rejects(as(peer,`select * from public.quotation_number_reservations`),/permission denied/);
      assert.equal((await as(peer,`select * from public.quotations where id='${q1}'`)).length,0);
    });
    await t.test("customer/default changes do not rewrite snapshots; invoice number and creator immutable",async()=>{
      await as(sales,`update public.customers set name='New name',address='New address',active=false where id='${customer}'`,{commit:true});
      await as(admin,`select public.save_quotation_defaults('${co}',2,'NEW',6,7,'New terms','New notes')`,{commit:true});
      await as(sales,`update public.quotations set number='Renumber',notes='Edited' where id='${q1}'`,{commit:true});
      saved=(await as(sales,`select * from public.quotations where id='${q1}'`))[0];
      assert.equal(saved.number,"JB-2026-00001");assert.equal(saved.customer_name,"Frozen customer");assert.equal(saved.customer_address,"Old address");assert.equal(saved.payment_terms,"Deposit");assert.equal(saved.validity_days,14);
      await assert.rejects(as(admin,`update public.quotations set created_by='${admin}' where id='${q1}'`),/permission denied/);
    });
    await t.test("Paid transitions record dates/actor, direct state forging blocked; trash restore retains dates",async()=>{
      const success=(await as(sales,`select * from public.manage_quotation('${co}','${q1}',${saved.revision},'success')`,{commit:true}))[0];assert(success.confirmed_at);assert.equal(success.paid_at,null);
      const paid=(await as(admin,`select * from public.manage_quotation('${co}','${q1}',${success.revision},'paid')`,{commit:true}))[0];assert(paid.paid_at);assert.equal(paid.created_by,sales);assert.equal(new Date(paid.confirmed_at).getTime(),new Date(success.confirmed_at).getTime());
      await assert.rejects(as(peer,`select public.manage_quotation('${co}','${q1}',${paid.revision},'pending')`),/access denied/);
      await assert.rejects(as(sales,`update public.quotations set paid_at=now(),status='paid' where id='${q1}'`),/permission denied/);
      const events=await as(sales,`select * from public.quotation_events where quote_id='${q1}' order by created_at`);assert(events.some(event=>event.details.status==="paid"&&event.actor===admin));
      assert.equal((await as(peer,`select * from public.quotation_events where quote_id='${q1}'`)).length,0);
      const trash=(await as(sales,`select * from public.manage_quotation('${co}','${q1}',${paid.revision},'trash')`,{commit:true}))[0];
      const restored=(await as(sales,`select * from public.manage_quotation('${co}','${q1}',${trash.revision},'restore')`,{commit:true}))[0];assert.equal(restored.status,"paid");assert.equal(new Date(restored.paid_at).getTime(),new Date(paid.paid_at).getTime());
      saved=restored;
      const legacyPaid=(await as(sales,`select * from public.manage_quotation('${co}','${old}',1,'paid')`,{commit:true}))[0];
      assert.equal(legacyPaid.confirmed_at,null,"pay marker must not invent missing historic confirmation date");assert(legacyPaid.paid_at);
    });
    await t.test("report respects Kuala Lumpur dates, excludes service and separates Paid from confirmed",async()=>{
      const today=(await db.query("select (now() at time zone 'Asia/Kuala_Lumpur')::date::text as d")).rows[0].d;
      const data=(await as(admin,`select public.company_sales_report('${co}','${today}','${today}') as report`))[0].report;
      const row=data.rows.find(row=>row.user_id===sales);assert.equal(row.confirmed_count,1);assert.equal(row.confirmed_amount,"78.75");assert.equal(row.paid_amount,"78.75");assert.equal(row.goods.length,1);assert.equal(row.goods[0].unit,"米");assert.equal(row.goods[0].quantity,"2.5");assert.equal(data.legacy_undated,1);
      const mixed=await create(sales,id(37),{...payload(),customer_id:null,discount:"0",items:[
        {product:{id:"kg",serial:"KG",name:"Material",unit:"公斤",is_service:false},quantity:0.75,unitPrice:14.9},
        {product:{id:"metre",serial:"M",name:"Wire",unit:"米",is_service:false},quantity:2.5,unitPrice:3.5}]});
      await as(sales,`select public.manage_quotation('${co}','${mixed.id}',${mixed.revision},'success')`,{commit:true});
      const mixedReport=(await as(admin,`select public.company_sales_report('${co}','${today}','${today}') as report`))[0].report.rows.find(r=>r.user_id===sales);
      assert.equal(mixedReport.confirmed_amount,"98.68");assert.equal(mixedReport.goods.length,2);
      assert.equal(mixedReport.goods.find(g=>g.unit==='公斤').quantity,"0.75");assert.equal(Number(mixedReport.goods.find(g=>g.unit==='米').quantity),5);
      await assert.rejects(as(sales,`select public.company_sales_report('${co}','${today}','${today}')`),/Administrator/);
      await as(admin,`select public.manage_quotation('${co}','${q1}',${saved.revision},'pending')`,{commit:true});
      const corrected=(await as(admin,`select public.company_sales_report('${co}','${today}','${today}') as report`))[0].report.rows.find(row=>row.user_id===sales);assert.equal(corrected.confirmed_count,1);assert.equal(Number(corrected.paid_amount),0);
      await db.exec(`update public.company_members set active=false where user_id='${sales}'`);assert.equal((await as(sales,"select * from public.customers")).length,0);
      assert.equal((await as(admin,`select * from public.customers where id='${customer}'`)).length,1);
      const inactiveReport=(await as(admin,`select public.company_sales_report('${co}','${today}','${today}') as report`))[0].report.rows.find(r=>r.user_id===sales);assert.equal(inactiveReport.confirmed_amount,"19.93");assert.equal(inactiveReport.active,false);
      await db.exec(`update public.companies set service_state='suspended' where id='${co}'`);
      await assert.rejects(as(admin,`select public.company_sales_report('${co}','${today}','${today}')`),/Administrator/);assert.equal((await as(admin,"select * from public.quotation_events")).length,0);
    });
  }finally{await db.close();}
});
