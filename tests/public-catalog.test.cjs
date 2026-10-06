const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm");
const {readFileSync}=require("node:fs"),{join}=require("node:path");
const ctx=vm.createContext({crypto:require("node:crypto").webcrypto,Uint8Array,Set,URLSearchParams,Response,Date,RegExp});
const source=f=>readFileSync(join(__dirname,"..",f),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/export /g,"");
vm.runInContext(source("lib/catalog-public.js")+source("lib/supabase/catalog-links.js")+";globalThis.api={newCatalogLinkRequest,publicCatalogDto,catalogSearchParams,catalogInquiryUrl,catalogImagePath,createCatalogLink}",ctx);
const api=ctx.api,id="d0000000-0000-4000-a000-000000000020",token="a".repeat(64);
test("public DTO whitelists price-free fields and excludes internal metadata",()=>{
  const dto=api.publicCatalogDto({whatsapp:"+60123456789",company_name:"A",seller_name:"S",items:[{id,serial:"P-1",name:"Part",price:12,cost:9,company_id:"private",image_path:"private",has_image:true}],price:5,token,creator_email:"private"});
  const text=JSON.stringify(dto);for(const word of ['price','cost','company_id','image_path','token','creator_email'])assert(!text.includes(word));assert.equal(dto.items[0].has_image,true);
});
test("opaque link request uses 256 bits, normalized selected ids, stable retry payload",async()=>{
  const r=api.newCatalogLinkRequest("company","  Test  ",[id,id]);assert.match(r.link_token,/^[0-9a-f]{64}$/);assert.equal(r.selected_ids.length,1);assert.equal(r.link_label,"Test");assert.notEqual(api.newCatalogLinkRequest("company","Test").link_token,r.link_token);
  let calls=[];const client={rpc:async(name,args)=>{calls.push(args);return{data:{token:args.link_token,id:args.request_id}};}};
  await api.createCatalogLink(client,r);await api.createCatalogLink(client,r);assert.equal(calls[0],calls[1]);assert.throws(()=>api.newCatalogLinkRequest("c","",[]));
});
test("bounded search/cursor and WhatsApp contact encode only product name/code",()=>{
  const params=api.catalogSearchParams(new URLSearchParams("q=100%25_safe"));assert.equal(params.search_text,"100%_safe");assert.throws(()=>api.catalogSearchParams(new URLSearchParams({q:"x".repeat(241)})));assert.throws(()=>api.catalogSearchParams(new URLSearchParams({after_id:id})));assert.throws(()=>api.catalogSearchParams(new URLSearchParams({after_id:"bad",after_created:"now()"})));
  const url=new URL(api.catalogInquiryUrl("+60123456789",{serial:"A & B",name:"水管 #1",price:12}));assert.equal(url.hostname,"wa.me");assert.equal(url.pathname,"/60123456789");assert(url.searchParams.get("text").includes("A & B"));assert(!url.searchParams.get("text").includes("12"));assert.equal(api.catalogInquiryUrl("javascript:bad",{}),"");
  assert(api.catalogImagePath(`d0000000-0000-4000-a000-000000000010/${id}/d0000000-0000-4000-a000-000000000030.png`,id));assert(!api.catalogImagePath(`../${id}/a.svg`,id));assert(!api.catalogImagePath(`https://evil.test/${id}/x.png`,id));
});
test("public route sanitizes unexpected upstream rows; invalid inputs never invoke DB",async()=>{
  const sandbox=vm.createContext({Response,URL,Date,RegExp});let calls=0;
  sandbox.catalogReader=()=>({rpc:async()=>{calls++;return{data:{company_name:"A",whatsapp:"+60123456789",items:[{id,name:"P",price:123}],price:999}};}});
  vm.runInContext(source("lib/catalog-public.js")+source("app/api/catalog/[token]/route.js")+";globalThis.get=GET",sandbox);
  const valid=await sandbox.get(new Request(`http://test/api/catalog/${token}`),{params:Promise.resolve({token})});assert.equal(valid.status,200);assert(!JSON.stringify(await valid.json()).includes("price"));assert.match(valid.headers.get("cache-control"),/no-store/);assert.equal(valid.headers.get("referrer-policy"),"no-referrer");
  assert.equal((await sandbox.get(new Request("http://test/?q="+"a".repeat(241)),{params:Promise.resolve({token})})).status,400);
  assert.equal((await sandbox.get(new Request("http://test/"),{params:Promise.resolve({token:"bad"})})).status,404);assert.equal(calls,1);
});
test("image route fail-closed, no signing, private bucket only and recheck after download",async()=>{
  const sandbox=vm.createContext({Response,URL,Date,RegExp});let allowed=true,downloaded=0,changed=false,missing=false;
  const path=`d0000000-0000-4000-a000-000000000010/${id}/d0000000-0000-4000-a000-000000000030.png`;
  sandbox.catalogReader=()=>({rpc:async()=>allowed?{data:path}:{error:{code:"42501"}}});
  sandbox.catalogImageReader=()=>{if(missing)throw Error("Missing server key");return{storage:{from:bucket=>{assert.equal(bucket,"salesgo-products");return{download:async p=>{assert.equal(p,path);downloaded++;if(changed)allowed=false;return{data:new Blob(["photo"],{type:"image/png"})};}};}}};};
  vm.runInContext(source("lib/catalog-public.js")+source("app/api/catalog/[token]/image/[product]/route.js")+";globalThis.get=GET",sandbox);
  const request=()=>sandbox.get(new Request("http://test/?full=1"),{params:Promise.resolve({token,product:id})});
  const success=await request();assert.equal(success.status,200);assert.equal(await success.text(),"photo");assert.match(success.headers.get("cache-control"),/no-store/);
  allowed=false;assert.equal((await request()).status,404);assert.equal(downloaded,1);
  allowed=true;changed=true;assert.equal((await request()).status,404);assert.equal(downloaded,2);
  allowed=true;missing=true;assert.equal((await request()).status,503);
});
