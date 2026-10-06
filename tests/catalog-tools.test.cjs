const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const source = file => readFileSync(join(__dirname,"..",file),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/export /g,"");
const context = vm.createContext({ crypto: require("node:crypto").webcrypto, TextEncoder, Blob, fetch, Set, Map });
vm.runInContext(source("app/quotation-utils.js")+source("lib/supabase/products.js")+source("lib/product-csv.js")+";globalThis.api={parseCsv,guessMapping,previewCsv,csvTemplate,quantityToMillis,lineCents,quotationTotals,signedProducts,readProductDetail}",context);
const api=context.api;
test("CSV BOM, quoted commas, escaped quotes/newlines and leading-zero identifiers",()=>{
  const parsed=api.parseCsv('\uFEFFSKU,Name,Price,Description\r\n00001,"A, B",1.50,"First\nSecond ""quoted"""\r\n');
  const rows=api.previewCsv(parsed,api.guessMapping(parsed.headers));
  assert.equal(rows[0].fields.serial,"00001");assert.equal(rows[0].fields.name,"A, B");assert.equal(rows[0].fields.description,'First\nSecond "quoted"');
  assert.equal(api.previewCsv(api.parseCsv(api.csvTemplate()),api.guessMapping(api.parseCsv(api.csvTemplate()).headers))[1].fields.is_service,true);
});
test("CSV duplicate/invalid rows are explained; delimiters and mappings validated",()=>{
  const parsed=api.parseCsv('sku;name;price\nA;One;1\na;Two;2\nB;Three;-1',";");
  const rows=api.previewCsv(parsed,api.guessMapping(parsed.headers));assert(rows[1].error.includes("重复"));assert(rows[2].error);
  for(const text of ['A,A\n1,2','A,B\n1','A,B\n"open,2','A,B\n"done"extra,2'])assert.throws(()=>api.parseCsv(text));
  assert.throws(()=>api.previewCsv(parsed,{serial:0,name:0,price:2}));
  assert.equal(api.parseCsv("sku\tname\tprice\nA\tOne\t1","\t").rows.length,1);
});
test("CSV error report retains invalid code/name and physical line after quoted newline",()=>{
  const parsed=api.parseCsv('SKU,Name,Price,Description\n00001,Good,1,"two\nlines"\n00002,Bad,-1,\n');
  const rows=api.previewCsv(parsed,api.guessMapping(parsed.headers));
  assert.equal(rows[1].csv_line,4);assert.equal(rows[1].raw_serial,"00002");assert.equal(rows[1].raw_name,"Bad");
});
test("fixed-point quantities accept up to 3 decimals and round each line exactly half up",()=>{
  for(const q of [0,-1,1.0001,"1e3",1000000,""])assert.equal(api.quantityToMillis(q),null);
  assert.equal(api.quantityToMillis("0.001"),1);assert.equal(api.quantityToMillis("999999"),999999000);
  assert.equal(api.lineCents({quantity:0.5,unitPrice:0.01}),1);
  assert.equal(api.lineCents({quantity:1.005,unitPrice:1}),101);
  assert.equal(api.lineCents({quantity:2.5,unitPrice:3.5}),875);
  assert.equal(api.quotationTotals([{quantity:0.5,unitPrice:0.01},{quantity:0.5,unitPrice:0.01}],0).subtotal,2);
});
test("page images sign thumbnail, explicit detail signs original",async()=>{
  const paths=[];const client={storage:{from:()=>({createSignedUrls:async(names)=>{paths.push(...names);return {data:names.map(path=>({path,signedUrl:"https://signed.test/"+path}))};}})}};
  const row={price:1,image_path:"original",thumbnail_path:"thumb"};
  assert.equal((await api.signedProducts(client,[row]))[0].image,"https://signed.test/thumb");
  assert.equal((await api.signedProducts(client,[row],{full:true}))[0].image,"https://signed.test/original");
  assert.deepEqual(paths,["thumb","original"]);
});
