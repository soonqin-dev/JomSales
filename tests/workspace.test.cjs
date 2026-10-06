const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync, readdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const crypto = require("node:crypto").webcrypto;
const source = file => readFileSync(join(__dirname,"..",file),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/export /g,"");
const context = vm.createContext({ crypto, TextEncoder, fetch, Blob, Set });
vm.runInContext(source("app/quotation-utils.js")+"\n"+source("lib/supabase/workspace.js")+"\nglobalThis.api={quotePayload,saveQuotation,readQuotation,listQuotations,manageQuotation,saveBrand,signedBrand,newDraft};", context);
const api = context.api;
const scope = {companyId:"40000000-0000-4000-a000-000000000010",userId:"40000000-0000-4000-a000-000000000001"};
const brand={id:scope.companyId,name:"Company A",contact:"Phone",logo_path:null,logo:"",brand_revision:1};
const draft=()=>({...api.newDraft(brand),items:[{product:{id:"P1",serial:"S1",name:"Frozen"},quantity:2,unitPrice:12.5}],details:{number:"Q1",date:"2026-10-04",customerName:"Client",phone:"123",notes:"",discount:"5"}});
function mock({ lost=false,conflict=false,signError=false,brandError=false }={}) {
  const rows=[],ranges=[],removed=[],uploads=[];
  const client={from(){let payload,op="select",filters={}; const q={select:()=>q,is:()=>q,not:()=>q,eq:(k,v)=>{filters[k]=v;return q;},order:()=>q,limit:()=>q,
    insert:p=>{payload=p;op="insert";return q;},update:p=>{payload=p;op="update";return q;},
    range:async(a,b)=>{ranges.push([a,b]);return {data:rows.slice(a,b+1)};},
    maybeSingle:async()=>{let row=rows.find(r=>Object.entries(filters).every(([k,v])=>r[k]===v));
      if(op!=="select"&&!conflict){row={...row,...payload,created_by:scope.userId,company_id:scope.companyId,company_snapshot:brand,revision:(row?.revision||0)+1}; rows.push(row);}
      return {data:op!=="select"&&(lost||conflict)?null:row||null,error:op!=="select"&&lost?{message:"lost reply"}:null};}
  };return q;},storage:{from:()=>({createSignedUrl:async()=>signError?{error:{message:"denied"}}:{data:{signedUrl:"https://signed.test/logo"}},
    upload:async(path,blob,options)=>{uploads.push({path,blob,options});return {};},remove:async(paths)=>{removed.push(...paths);return {data:paths};}})},
    rpc:async(name,params)=>{
      if(name==="create_quotation"){
        const row={...params.payload,id:params.target_quote,number:"Q-2026-00001",created_by:scope.userId,company_id:scope.companyId,company_snapshot:brand,revision:1};
        rows.push(row);return lost?{error:{message:"lost reply"}}:{data:row};
      }
      return brandError?{error:{message:"revision conflict"}}:{data:{...brand,name:params.company_name,contact:params.company_contact,logo_path:params.new_logo_path,brand_revision:2}};
    }};
  return {client,rows,ranges,removed,uploads};
}
test("quotation fields strip computed/extraneous data and reject invalid snapshots/totals",()=>{
  const p=api.quotePayload(draft());assert.equal(p.discount,"5.00");assert(!("lineTotal" in p.items[0]));
  for(const edit of [d=>d.items[0].quantity=0,d=>d.items[0].unitPrice=1.999,d=>d.items[0].product.name="",d=>d.items.push(d.items[0]),d=>d.details.discount="100",d=>d.details.phone="x".repeat(41)]){const d=draft();edit(d);assert.throws(()=>api.quotePayload(d));}
});
test("quotation save recovers only identical committed lost replies and rejects stale different payload",async()=>{
  const m=mock({lost:true}),d=draft();const result=await api.saveQuotation(m.client,scope,d);
  assert.equal(result.items[0].lineTotal,25);assert.equal(result.company.name,"Company A");assert.equal(result.dirty,false);
  const stale=mock({conflict:true});stale.rows.push({...m.rows[0],notes:"newer edit"});
  await assert.rejects(api.saveQuotation(stale.client,scope,{...result,details:{...result.details,notes:"stale"}}),/其他设备修改/);
  assert.equal(stale.rows[0].notes,"newer edit");
});
test("history pagination continues beyond 500 and signed branding failures are explicit",async()=>{
  const m=mock({signError:true});m.rows.push(...Array.from({length:1001},(_,id)=>({id})));
  assert.equal((await api.listQuotations(m.client,scope.companyId)).length,1001);assert.equal(m.ranges.length,3);
  const signed=await api.signedBrand(m.client,{...brand,logo_path:"existing"});assert.match(signed.logoError,/无法读取/);assert.equal(signed.logo,"");
});

test("default entry never reads last quotation; lifecycle RPC preserves scoped revision",async()=>{
  const forbidden={from(){throw Error("must not fetch latest saved quote");}};
  assert.equal(await api.readQuotation(forbidden,scope),null);
  const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{id:"q",status:"success",revision:3}};}};
  const result=await api.manageQuotation(client,scope.companyId,{id:"q",revision:2},"success");
  assert.equal(result.status,"success");assert.equal(calls[0].args.expected_revision,2);assert.equal(calls[0].args.target_company,scope.companyId);
  await assert.rejects(api.manageQuotation(client,scope.companyId,{id:"q",revision:2},"purge"),/无效/);
  await assert.rejects(api.manageQuotation({rpc:async()=>({error:{message:"denied"}})},scope.companyId,{id:"q",revision:2},"trash"),/denied/);
});
test("branding preserves broken referenced logos unless explicitly removed, never upserts, cleans failed new uploads",async()=>{
  const m=mock(),previous={...brand,logoError:"broken",logo_path:"existing",logo:""};
  assert.equal((await api.saveBrand(m.client,previous,{...previous,name:"Updated"})).logo_path,"existing");
  assert.equal((await api.saveBrand(m.client,previous,{...previous,removeLogo:true})).logo_path,null);
  const failed=mock({brandError:true});await assert.rejects(api.saveBrand(failed.client,brand,{...brand,logo:"data:image/png;base64,aGVsbG8="}),/保存未确认/);
  assert.equal(failed.uploads[0].options.upsert,false);assert.equal(failed.removed[0],failed.uploads[0].path);
});
test("no application code reads/writes local business storage and migration implementation is removed",()=>{
  function inspect(dir) {
    for(const entry of readdirSync(dir,{withFileTypes:true})) {
      const file=join(dir,entry.name);
      if(entry.isDirectory())inspect(file);
      else if(entry.name.endsWith(".js"))assert(!/\blocalStorage\b|readStoredJson/.test(readFileSync(file,"utf8").replace(/\/\*.*?\*\//gs,"").replace(/^\s*\/\/.*$/gm,"")),file);
    }
  }
  for(const dir of ["app","lib"])inspect(join(__dirname,"..",dir));
  for(const file of ["app/storage.js","app/migration/Migration.js","lib/supabase/migration.js"]) assert(!existsSync(join(__dirname,"..",file)));
});
