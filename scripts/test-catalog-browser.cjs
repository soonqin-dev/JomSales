// Isolated API fixture, no production Supabase writes. Real phone-width browser.
const { chromium } = require(process.env.SALESGO_PLAYWRIGHT_MODULE || "playwright");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { createFixture } = require("./workspace-browser-fixture.cjs");
const fixture=createFixture(54351),base="http://localhost:54352",errors=[];
for(let i=1;i<=200;i++)fixture.products.push({id:`b0000000-0000-4000-a000-${String(i).padStart(12,"0")}`,company_id:fixture.CA,serial:`B-${String(i).padStart(4,"0")}`,name:i===190?"Deep search target":"Bulk product "+i,tags:[],price:3.5,unit:"米",description:"Material",is_service:false,image_path:null,thumbnail_path:null,revision:1,deleted_at:null,created_at:"2026-01-01T00:00:00.000Z"});
const next=join(__dirname,"../node_modules/next/dist/bin/next"),env={...process.env,JOMSALES_BUILD_DIR:`.next-launchpad-catalog-${process.pid}`,NEXT_PUBLIC_SUPABASE_URL:fixture.origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_local_fixture"};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let server,browser,diagnostic;
(async()=>{
  try{
    await new Promise(resolve=>fixture.server.listen(54351,resolve));
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[next,"build"],{env,stdio:"inherit"});child.on("error",reject);child.on("exit",code=>code?reject(Error("Build failed")):resolve());});
    server=spawn(process.execPath,[next,"start","-p","54352"],{env,stdio:"inherit"});
    for(let i=0;i<100;i++){try{if((await fetch(base+"/account")).ok)break;}catch{}await wait(200);}
    browser=await chromium.launch({channel:process.env.SALESGO_BROWSER_CHANNEL||"msedge",headless:true});
    const button=(p,name)=>p.getByRole("button",{name,exact:true});
    async function open(key){
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
      page.on("pageerror",err=>errors.push(err.message));page.on("dialog",dialog=>dialog.accept());
      await page.goto(base+"/account");await page.getByLabel("邮箱",{exact:true}).fill(fixture.users[key].email);await page.getByLabel("密码",{exact:true}).fill("fixture-password");await page.locator("button[type=submit]").click();
      await button(page,"查看 Cloud Widget 详情").waitFor();return{context,page};
    }
    async function ready(page){await page.waitForFunction(()=>!document.body.innerText.includes("正在搜索公司目录…")&&!document.body.innerText.includes("正在读取云端产品…"));}
    const owner=await open("owner"),page=owner.page;diagnostic=page;await ready(page);
    assert.equal(await page.locator("article.card").count(),30);
    await button(page,"查看 Cloud Widget 详情").click();await button(page,"＋ 加入报价清单").click();await button(page,"关闭产品详情").click();
    assert.match(await page.locator(".quotationCartButton").innerText(),/1 项/);
    await button(page,"下一页").click();await ready(page);await page.getByText("第 2 页 · 每页最多 30 项",{exact:true}).waitFor();assert.equal(await page.locator("article.card").count(),30);
    assert.match(await page.locator(".quotationCartButton").innerText(),/1 项/,"paging must retain unsaved quotation");
    await button(page,"＋ 新建报价单").click();assert.match(await page.locator(".quotationCartButton").innerText(),/0 项/);
    await page.getByLabel("搜索产品",{exact:true}).fill("Deep search target");await button(page,"查看 Deep search target 详情").waitFor();assert.equal(await page.locator("article.card").count(),1);
    await page.getByLabel("搜索产品",{exact:true}).fill("slow");await wait(330);await page.getByLabel("搜索产品",{exact:true}).fill("Deep search target");await button(page,"查看 Deep search target 详情").waitFor();await wait(1000);assert.equal(await page.locator("article.card").count(),1);assert.equal(await button(page,"查看 Deep search target 详情").count(),1);
    console.log("PASS bounded page, off-page cloud search and stale-search suppression");
    await button(page,"查看 Deep search target 详情").click();await button(page,"＋ 加入报价清单").click();await button(page,"关闭产品详情").click();
    await page.getByRole("button",{name:/查看 \/ 生成报价/}).click();await page.getByLabel("B-0190 数量",{exact:true}).fill("2.5");await page.getByText("行金额",{exact:false}).filter({hasText:"RM 8.75"}).waitFor();
    await page.getByLabel("客户名称 *",{exact:true}).fill("Decimal customer");const download=page.waitForEvent("download");await button(page,"生成报价 PDF").click();assert((await download).suggestedFilename().endsWith(".pdf"));
    assert.equal(fixture.quotations.at(-1).items[0].quantity,2.5);assert.equal(fixture.quotations.at(-1).items[0].product.unit,"米");
    await page.locator(".activeQuotation").filter({hasText:/^新报价$/}).waitFor();console.log("PASS decimal quotation save/PDF and unit snapshot");
    await page.getByRole("link",{name:"目录设置与导入",exact:true}).click();await page.getByText("产品编号设置",{exact:true}).click();await page.getByLabel("编号前缀",{exact:true}).fill("HW-");await page.getByLabel("流水号位数",{exact:true}).fill("4");await page.getByLabel("下一个流水号",{exact:true}).fill("500");await button(page,"保存编号规则").click();await page.getByRole("status").filter({hasText:"编号规则已保存"}).waitFor();
    await page.getByRole("link",{name:"← 产品目录",exact:true}).click();await ready(page);await button(page,"清除").count()&&await button(page,"清除").click();await ready(page);await button(page,"＋ 新增产品").click();
    await page.getByLabel("名称 *",{exact:true}).fill("Auto-number wire");await page.locator(".priceInput input").fill("2.00");await page.getByText("单位、分类与说明（可选）",{exact:true}).click();await page.getByLabel("单位",{exact:true}).fill("米");
    await page.getByLabel("产品照片",{exact:true}).setInputFiles({name:"tiny.png",mimeType:"image/png",buffer:fixture.png});await page.waitForFunction(()=>!document.body.innerText.includes("正在转换图片…"));fixture.state.failProductReply=true;
    await button(page,"保存产品").click();await page.locator(".overlay").waitFor({state:"detached"});await button(page,"查看 Auto-number wire 详情").waitFor();
    const created=fixture.products.find(p=>p.name==="Auto-number wire");assert.equal(created.serial,"HW-0500");assert(created.thumbnail_path);assert(created.image_hash);assert.equal(fixture.products.filter(p=>p.name==="Auto-number wire").length,1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log("PASS auto numbering, physical thumbnail and lost-product-response recovery");
    await page.getByRole("link",{name:"目录设置与导入",exact:true}).click();const before=fixture.products.length;
    await page.getByLabel("选择 CSV 文件",{exact:true}).setInputFiles({name:"fixture.csv",mimeType:"text/csv",buffer:Buffer.from("SKU,Name,Price,Unit,Type\n00009,CSV item,12.50,盒,product\nNEW-SV,CSV service,80,小时,service\nP-001,Existing,1,件,product\nBAD,Invalid,-1,件,product\n")});
    await button(page,"预览并检查重复编号").click();await page.getByText("共 4 行 · 可新增 2 · 格式错误 1 · 已有编号 1",{exact:true}).waitFor();assert.equal(fixture.products.length,before);
    fixture.state.failImport=true;await button(page,"确认新增导入").click();await page.getByRole("alert").filter({hasText:"Simulated lost import reply"}).waitFor();assert.equal(fixture.products.length,before+2);
    await button(page,"继续／重试未完成项目").click();await page.getByRole("status").filter({hasText:/已确认新增 2/}).waitFor();assert.equal(fixture.products.length,before+2);assert(fixture.products.find(p=>p.serial==="00009"));
    const report=page.waitForEvent("download");await button(page,"下载完整检查／导入结果").click();assert.equal((await report).suggestedFilename(),"jomsales-import-results.csv");assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log("PASS CSV preview/no writes, duplicate/error handling, lost-reply safe retry and result export");
    const sales=await open("sales");assert.equal(await button(sales.page,"＋ 新增产品").count(),0);assert.equal(await sales.page.getByRole("link",{name:"目录设置与导入",exact:true}).count(),0);
    await sales.page.goto(base+"/catalog-settings?company="+fixture.CA);await sales.page.getByText(/此页面仅供该公司管理员使用/).waitFor();assert.equal(await sales.page.getByLabel("选择 CSV 文件",{exact:true}).count(),0);
    assert.deepEqual(errors,[]);console.log("PASS sales UI permission boundary and no browser runtime errors");
  }catch(err){if(diagnostic)console.error("Browser diagnostics",diagnostic.url(),await diagnostic.locator("body").innerText(),errors);throw err;}
  finally{await browser?.close();server?.kill();await new Promise(resolve=>fixture.server.close(resolve));}
})().catch(err=>{console.error(err);process.exitCode=1;});
