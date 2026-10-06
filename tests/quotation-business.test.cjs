const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm");
const {readFileSync}=require("node:fs"),{join}=require("node:path");
const source=file=>readFileSync(join(__dirname,"..",file),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/export /g,"");
const ctx=vm.createContext({crypto:require("node:crypto").webcrypto,Set,fetch,Blob});
vm.runInContext(source("app/quotation-utils.js")+source("lib/supabase/workspace.js")+source("lib/supabase/customers.js").replace(/const fail =[^\n]*\n/,"")+";globalThis.api={newDraft,duplicateDraft,quotePayload,customerFields,formatAmount,quoteStatus,saveCustomer}",ctx);
const api=ctx.api;
test("defaults apply to new drafts; duplicate keeps history and resets identity/status/date/number",()=>{
  const defaults={notes:"Default terms",payment_terms:"Deposit",validity_days:30},brand={name:"Company"},fresh=api.newDraft(brand,defaults);
  assert.equal(fresh.details.number,"");assert.equal(fresh.details.notes,"Default terms");assert.equal(fresh.details.validityDays,"30");
  const saved={...fresh,row:{id:"old",revision:5,status:"paid",created_by:"employee"},items:[{product:{id:"oldpart",serial:"SKU",name:"Old name",unit:"米"},quantity:2.5,unitPrice:3.5}],details:{...fresh.details,number:"OLD",date:"2020-01-01",customerId:"private-contact",notes:"Historic notes"}};
  const copy=api.duplicateDraft(saved,{name:"New brand"},defaults);assert.notEqual(copy.row.id,"old");assert.equal(copy.row.status,"pending");assert.equal(copy.row.revision,0);assert.equal(copy.details.number,"");assert.equal(copy.details.customerId,null);assert.equal(copy.details.notes,"Historic notes");assert.equal(copy.company.name,"New brand");
  copy.items[0].product.name="Copy edited";assert.equal(saved.items[0].product.name,"Old name");
});
test("new quotation payload excludes number and lifecycle, retains customer/terms/temporary snapshots",()=>{
  const d=api.newDraft({name:"A"});d.items=[{product:{id:"temp-1",serial:"临时",name:"Labour",unit:"小时",temporary:true,is_service:true},quantity:1.25,unitPrice:60}];d.details.customerName="Customer";
  const payload=api.quotePayload(d);assert(!("number" in payload));assert(!("status" in payload));assert.equal(payload.items[0].product.temporary,true);assert.equal(payload.validity_days,14);
  d.details.validityDays="366";assert.throws(()=>api.quotePayload(d));d.details.validityDays="14";d.details.email="invalid";assert.throws(()=>api.quotePayload(d));
});
test("customer validation and precise amount/status labels",()=>{
  assert.equal(api.customerFields({name:"  Alice  ",email:"alice@example.test"}).name,"Alice");
  assert.throws(()=>api.customerFields({name:"",email:"bad"}));assert.throws(()=>api.customerFields({name:"A",email:"bad"}));
  assert.equal(api.formatAmount("123456789012345678.75"),"RM 123,456,789,012,345,678.75");assert.equal(api.formatAmount("0"),"RM 0.00");assert.equal(api.formatAmount(null),"—");assert.match(api.quoteStatus("paid"),/人工/);
});
