const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm");
const {readFileSync}=require("node:fs"),{join}=require("node:path");
const source=f=>readFileSync(join(__dirname,"..",f),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/export /g,"");
const ctx=vm.createContext({Map,Set});vm.runInContext(source("app/quotation-utils.js")+source("lib/product-csv.js")+source("lib/product-price-csv.js")+";globalThis.api={parseCsv,guessPriceMapping,previewPriceCsv,matchPricePreview,priceUpdateEntry,priceReportCsv}",ctx);const api=ctx.api;
const preview=(csv,delimiter=",")=>{const p=api.parseCsv(csv,delimiter);return api.previewPriceCsv(p,api.guessPriceMapping(p.headers));};
test("price CSV needs only SKU and price; leading zeros preserved and non-price fields ignored",()=>{
  const rows=preview('\uFEFFSKU,Price,Name,Description\n0000123,12.5,DO NOT CHANGE,"two\nlines"\nHW-1,0,Ignore,Ignore\n');assert.equal(rows[0].serial,"0000123");assert.equal(rows[0].new_price,"12.50");assert.equal(rows[1].new_price,"0.00");assert.equal(rows[1].csv_line,4);
  assert.equal(preview("code;unitprice\nP-1;99.99",";")[0].new_price,"99.99");assert.equal(preview("产品编号\t单价\nP-1\t1.00","\t")[0].new_price,"1.00");
  const p=api.parseCsv("A,B\nSKU,1");assert.throws(()=>api.previewPriceCsv(p,{serial:0,price:0}));
  assert.equal(preview("SKU,OldPrice,NewPrice\nP-1,1,2")[0].new_price,"2.00");assert.equal(preview("SKU,Price,新单价\nP-1,1,3")[0].new_price,"3.00");assert.equal(api.guessPriceMapping(["SKU","NewPrice","新价格"]).price,-1);
});
test("every duplicate occurrence skipped, including first row or another invalid price",()=>{
  const rows=preview("SKU,Price\nA,1\na,2\nB,-1\nb,3\nC,\nD,1.001\nE,10000000\nF,1e3\nG,0\n");for(const i of [0,1,2,3])assert.match(rows[i].error,/重复/);for(const i of [4,5,6,7])assert(rows[i].error);assert.equal(rows[8].status,"pending");
});
test("matching ignores case but not leading zeros; unchanged/missing distinct; payload price-only",()=>{
  const rows=api.matchPricePreview(preview("SKU,Price\n0001,5.25\nONE,9\nMissing,1\n"),[{id:"a",serial:"0001",name:"Part",price:"3.50",revision:7},{id:"b",serial:"one",price:"9.00",revision:2}]);
  assert.equal(rows[0].status,"ready");assert.equal(rows[1].status,"unchanged");assert.equal(rows[2].status,"missing");const entry=api.priceUpdateEntry(rows[0]);assert.deepEqual(Object.keys(entry).sort(),["row_number","csv_line","product_id","serial","expected_revision","old_price","new_price"].sort());assert.equal(entry.expected_revision,7);assert.equal(entry.old_price,"3.50");assert(!("name" in entry));assert.throws(()=>api.priceUpdateEntry(rows[1]));
});
test("result CSV contains pre-change prices, physical line and spreadsheet formula protection",()=>{
  const rows=api.matchPricePreview(preview('SKU,Price\n"=BAD",-1\nGood,2\n'),[{id:"p",serial:"Good",name:"=Unsafe name",price:"1.00",revision:1}]);const csv=api.priceReportCsv(rows,{2:{status:"updated",old_price:"1.00",new_price:"2.00"}});assert(csv.startsWith("\uFEFF"));assert(csv.includes("'=BAD"));assert(csv.includes("'-1"));assert(csv.includes("'=Unsafe name"));assert(csv.includes('"1.00","2.00","已调价"'));
});
