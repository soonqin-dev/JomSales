// Builds a test deployment against a local API double, never the live Supabase project.
// Run `npm run build` afterwards to restore a production-configured .next output.
const { chromium }=require(process.env.SALESGO_PLAYWRIGHT_MODULE||"playwright");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {join}=require("node:path");
const {createFixture}=require("./workspace-browser-fixture.cjs");
const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
const fixture=createFixture(),base="http://localhost:54330",errors=[];
const next=join(__dirname,"../node_modules/next/dist/bin/next");
const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:fixture.origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_local_test_fixture"};
let server,browser,diagnosticPage;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function build(){await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[next,"build"],{env,stdio:"inherit"});p.on("error",reject);p.on("exit",code=>code?reject(Error(`Test build exited ${code}`)):resolve());});}
(async()=>{
  try {
    await new Promise(r=>fixture.server.listen(54329,r));await build();
    server=spawn(process.execPath,[next,"start","-p","54330"],{env,stdio:"inherit"});
    let started=false;for(let i=0;i<60;i++){try{await fetch(base+"/account");started=true;break;}catch{await wait(250);}}assert(started,"Next test server starts");
    browser=await chromium.launch({channel:process.env.SALESGO_BROWSER_CHANNEL||"msedge",headless:true});
    async function open(key=null,legacy=null) {
      const ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage();
      page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
      if(legacy)await ctx.addInitScript(data=>{for(const [key,value] of Object.entries(data))if(localStorage.getItem(key)===null)localStorage.setItem(key,JSON.stringify(value));},legacy);
      await page.goto(base+"/");await page.waitForURL("**/account");
      if(key){await page.getByLabel("邮箱",{exact:true}).fill(fixture.users[key].email);await page.getByLabel("密码",{exact:true}).fill("fixture-password");await page.locator("button[type=submit]").click();
        if(key==="new"||key==="disabled")await page.getByRole("heading",{name:"创建你的公司"}).waitFor();else await page.getByRole("heading",{name:"公司云端产品"}).waitFor();}
      return {page,ctx};
    }
    const anon=await open();for(const path of ["/cloud","/team","/brand","/quotations","/migration"]){await anon.page.goto(base+path);await anon.page.waitForURL("**/account");assert(!await anon.page.getByText("Cloud Widget",{exact:true}).count());}console.log("PASS anonymous protected routes");
    const legacy={salesgo_catalog_v1:[{id:"legacy-1",serial:"OLD-001",name:"Old Local Product",price:"8",tags:[],image:""}],salesgo_quotation_v1:[{product:{id:"legacy-1",serial:"OLD-001",name:"Old Local Product"},quantity:2,unitPrice:8,lineTotal:16}],salesgo_quotation_details_v1:{details:{number:"Q-OLD",date:"2026-09-01",customerName:"Legacy Client",phone:"321",notes:"Old notes",discount:"0"},company:{name:"Legacy Brand",contact:"Old phone",logo:""}}};
    const owner=await open("owner",legacy),page=owner.page;diagnosticPage=page;
    await page.getByRole("button",{name:"查看 Cloud Widget 详情"}).waitFor();assert(!await page.getByText("Old Local Product",{exact:true}).count());
    assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith("salesgo_")).map(k=>[k,JSON.parse(localStorage.getItem(k))]))),legacy);
    await page.getByRole("link",{name:"公司品牌",exact:true}).click();await page.getByLabel("公司名称",{exact:true}).fill("Cloud Brand");await page.getByLabel("公司联系方式").fill("+60 cloud phone");
    await page.getByLabel("公司 Logo",{exact:true}).setInputFiles({name:"logo.png",mimeType:"image/png",buffer:fixture.png});
    await page.getByRole("button",{name:"保存公司品牌",exact:true}).click();await page.getByText(/公司品牌已保存到云端/).waitFor();assert(fixture.companies[0].logo_path);
    await page.getByRole("link",{name:"← 公司产品目录"}).click();await page.getByRole("button",{name:"查看 Cloud Widget 详情"}).click();
    await page.getByRole("button",{name:"下载产品卡片",exact:true}).waitFor();
    const jpgEvent=page.waitForEvent("download");await page.getByRole("button",{name:"下载产品卡片",exact:true}).click();const jpg=await jpgEvent;assert(jpg.suggestedFilename().endsWith(".jpg"));
    await page.getByRole("button",{name:"＋ 加入报价清单",exact:true}).click();await page.getByText("已加入报价清单，并保存到公司云端。",{exact:true}).waitFor();assert.equal(fixture.quotations.length,1);
    await page.getByRole("button",{name:/查看报价清单（/}).click();await page.getByLabel("客户名称 *",{exact:true}).fill("Cloud Client");await page.getByLabel("客户电话",{exact:true}).fill("+60 111");
    await page.getByLabel("P-001 数量",{exact:true}).fill("2");await page.getByLabel("折扣（RM）",{exact:true}).fill("5");
    await page.getByRole("button",{name:"保存到云端",exact:true}).click();await page.getByText("已保存到公司云端，可在其他设备重新打开。",{exact:true}).waitFor();
    await page.getByRole("button",{name:"生成报价 PDF",exact:true}).click();await page.getByRole("button",{name:"下载 PDF",exact:true}).waitFor();
    const pdfEvent=page.waitForEvent("download");await page.getByRole("button",{name:"下载 PDF",exact:true}).click();assert((await pdfEvent).suggestedFilename().endsWith(".pdf"));
    const quoteId=fixture.quotations[0].id;assert.equal(fixture.quotations[0].customer_name,"Cloud Client");assert.equal(fixture.quotations[0].items[0].quantity,2);assert.equal(fixture.quotations[0].discount,"5.00");
    assert.equal(fixture.quotations[0].company_snapshot.name,"Cloud Brand");console.log("PASS company brand, JPG card and saved quotation PDF");
    const second=await open("owner");await second.page.goto(`${base}/cloud?company=${fixture.CA}&quote=${quoteId}`);await second.page.getByRole("heading",{name:"报价清单",exact:true}).waitFor();assert.equal(await second.page.getByLabel("客户名称 *",{exact:true}).inputValue(),"Cloud Client");
    await second.page.getByLabel("备注",{exact:true}).fill("Newer device note");await second.page.getByRole("button",{name:"保存到云端",exact:true}).click();await second.page.getByText("已保存到公司云端，可在其他设备重新打开。",{exact:true}).waitFor();
    await page.getByLabel("备注",{exact:true}).fill("Stale note");await page.getByRole("button",{name:"保存到云端",exact:true}).click();await page.getByText(/报价已被其他设备修改/).first().waitFor();assert.equal(fixture.quotations.find(q=>q.id===quoteId).notes,"Newer device note");
    await page.getByRole("button",{name:"← 返回产品目录",exact:true}).click();await page.getByRole("button",{name:"重新读取报价与品牌",exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector(".quotationCartButton")?.disabled);
    await page.getByRole("button",{name:/查看 \/ 生成报价/}).click();await page.getByRole("heading",{name:"报价清单",exact:true}).waitFor();await page.getByLabel("备注",{exact:true}).fill("Retained failed save");fixture.state.failQuote=true;
    await page.getByRole("button",{name:"保存到云端",exact:true}).click();await page.getByText(/Simulated quote save failure/).first().waitFor();assert.equal(await page.getByLabel("备注",{exact:true}).inputValue(),"Retained failed save");
    assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith("salesgo_")).map(k=>[k,JSON.parse(localStorage.getItem(k))]))),legacy);
    await page.getByRole("button",{name:"保存到云端",exact:true}).click();await page.getByText("已保存到公司云端，可在其他设备重新打开。",{exact:true}).waitFor();
    console.log("PASS cross-device reopen, stale conflict and no local fallback after failed save");
    const sales=await open("sales");await sales.page.getByRole("button",{name:"＋ 新增产品",exact:true}).waitFor();assert(await sales.page.getByRole("button",{name:"＋ 新增产品",exact:true}).isDisabled());
    await sales.page.getByRole("button",{name:"查看 Cloud Widget 详情"}).click();await sales.page.getByRole("button",{name:"＋ 加入报价清单",exact:true}).click();await sales.page.getByText("已加入报价清单，并保存到公司云端。",{exact:true}).waitFor();
    await sales.page.goto(base+"/quotations");await sales.page.getByRole("link",{name:"打开 / 修改报价"}).waitFor();assert.equal(await sales.page.getByRole("link",{name:"打开 / 修改报价"}).count(),1);assert(!await sales.page.getByText("Cloud Client",{exact:true}).count());
    await sales.page.goto(base+"/brand");await sales.page.getByText(/此页面仅供该公司管理员使用/).waitFor();assert(!await sales.page.getByRole("button",{name:"保存公司品牌",exact:true}).count());
    const other=await open("other");await other.page.getByRole("button",{name:"查看 Company B only 详情"}).waitFor();assert(!await other.page.getByRole("button",{name:"查看 Cloud Widget 详情"}).count());
    await other.page.goto(`${base}/cloud?company=${fixture.CA}&quote=${quoteId}`);await other.page.getByText(/你尚未加入公司/).first().waitFor();assert(!await other.page.getByLabel("客户名称 *",{exact:true}).count());
    await page.goto(base+"/quotations");await page.getByRole("link",{name:"打开 / 修改报价"}).first().waitFor();assert.equal(await page.getByRole("link",{name:"打开 / 修改报价"}).count(),2);console.log("PASS own/admin quotation lists and separate companies");
    const cloudBefore=JSON.stringify({products:fixture.products,quotations:fixture.quotations,companies:fixture.companies});
    await page.goto(`${base}/migration?company=${fixture.CA}`);await page.waitForURL(`${base}/cloud?company=${fixture.CA}`);await page.getByRole("button",{name:"查看 Cloud Widget 详情"}).waitFor();
    assert(!await page.getByRole("link",{name:"迁移旧浏览器资料",exact:true}).count());assert(!await page.getByRole("button",{name:"读取并预览旧资料",exact:true}).count());assert(!await page.getByText("Old Local Product",{exact:true}).count());
    assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith("salesgo_")).map(k=>[k,JSON.parse(localStorage.getItem(k))]))),legacy);
    assert.equal(JSON.stringify({products:fixture.products,quotations:fixture.quotations,companies:fixture.companies}),cloudBefore);
    await page.goto(base+"/migration?company=https%3A%2F%2Fexample.test");await page.waitForURL(base+"/cloud");
    console.log("PASS retired migration redirects safely, no legacy reads/import and unchanged cloud/original records");
    await sales.page.goto(base+"/cloud");await sales.page.getByRole("button",{name:"＋ 新建报价单",exact:true}).waitFor();
    assert(await sales.page.getByRole("button",{name:"＋ 新增产品",exact:true}).isDisabled());
    await sales.page.waitForFunction(()=>!document.querySelector(".newQuotationButton")?.disabled);
    for(const width of [320,390,844]) {
      await sales.page.setViewportSize({width,height:844});
      assert(await sales.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`new-quote controls fit ${width}px`);
    }
    await sales.page.setViewportSize({width:390,height:844});
    const employeeBefore=JSON.stringify(fixture.quotations),oldEmployee=fixture.quotations.find(q=>q.created_by===fixture.users.sales.id);
    await sales.page.getByRole("button",{name:"＋ 新建报价单",exact:true}).click();await sales.page.getByRole("heading",{name:"报价清单",exact:true}).waitFor();
    assert.equal(await sales.page.getByLabel("客户名称 *",{exact:true}).inputValue(),"");assert.equal(await sales.page.locator(".quotationItem").count(),0);
    assert.notEqual(await sales.page.getByLabel("报价编号",{exact:true}).inputValue(),oldEmployee.number);assert.equal(JSON.stringify(fixture.quotations),employeeBefore);
    await sales.page.getByLabel("客户名称 *",{exact:true}).fill("New employee quote");await sales.page.getByRole("button",{name:"← 返回产品目录",exact:true}).click();
    sales.page.removeAllListeners("dialog");sales.page.once("dialog",d=>d.dismiss());
    await sales.page.getByRole("button",{name:"＋ 新建报价单",exact:true}).click();assert(!await sales.page.getByRole("heading",{name:"报价清单",exact:true}).count());
    await sales.page.getByRole("button",{name:/查看 \/ 生成报价/}).click();assert.equal(await sales.page.getByLabel("客户名称 *",{exact:true}).inputValue(),"New employee quote");
    sales.page.on("dialog",d=>d.accept());await sales.page.getByRole("button",{name:"保存到云端",exact:true}).click();await sales.page.getByText("已保存到公司云端，可在其他设备重新打开。",{exact:true}).waitFor();
    const newEmployee=fixture.quotations.find(q=>q.customer_name==="New employee quote");assert(newEmployee);assert.notEqual(newEmployee.id,oldEmployee.id);assert.equal(newEmployee.created_by,fixture.users.sales.id);
    assert.equal(fixture.quotations.find(q=>q.id===oldEmployee.id).number,oldEmployee.number);assert(!new URL(sales.page.url()).searchParams.has("new"));
    await sales.page.reload();await sales.page.getByRole("heading",{name:"报价清单",exact:true}).waitFor();assert.equal(await sales.page.getByLabel("客户名称 *",{exact:true}).inputValue(),"New employee quote");
    console.log("PASS catalog new quotation for read-only sales, responsive layout, cancel protection, preserved history and saved refresh");
    await sales.page.goto(base+"/cloud");fixture.members.find(m=>m.user_id===fixture.users.sales.id).can_manage_products=true;await sales.page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await sales.page.getByRole("button",{name:"＋ 新增产品",exact:true}).waitFor();await sales.page.waitForFunction(()=>!document.querySelector(".addButton")?.disabled);await sales.page.getByRole("button",{name:"＋ 新增产品",exact:true}).click();
    fixture.members.find(m=>m.user_id===fixture.users.sales.id).can_manage_products=false;await sales.page.evaluate(()=>window.dispatchEvent(new Event("focus")));await sales.page.locator(".overlay").waitFor({state:"detached"});
    fixture.members.find(m=>m.user_id===fixture.users.sales.id).active=false;await sales.page.evaluate(()=>window.dispatchEvent(new Event("focus")));await sales.page.getByText(/公司权限已被停用/).first().waitFor();assert(!await sales.page.getByRole("button",{name:"查看 Cloud Widget 详情"}).count());
    await page.goto(base+"/account");await page.getByRole("button",{name:"退出此设备的登录",exact:true}).click();await page.getByLabel("邮箱",{exact:true}).waitFor();await page.goto(base+"/cloud");await page.waitForURL("**/account");console.log("PASS permission revoke, employee disable and logout clears workspace");
    const forged=await browser.newContext();const fake=fixture.session(fixture.users.owner);fake.access_token=fake.access_token.replace(/[^.]+$/,"forged");
    await forged.addCookies([{name:"sb-localhost-auth-token",value:"base64-"+encode(fake),domain:"localhost",path:"/"}]);const forgedPage=await forged.newPage();await forgedPage.goto(base+"/cloud");await forgedPage.waitForURL("**/account");console.log("PASS server rejects forged session user");
    const refresh=await browser.newContext(),oldSession=fixture.session(fixture.users.owner);oldSession.expires_at=Math.floor(Date.now()/1000)-30;
    const oldCookie="base64-"+encode(oldSession);await refresh.addCookies([{name:"sb-localhost-auth-token",value:oldCookie,domain:"localhost",path:"/"}]);
    const refreshPage=await refresh.newPage(),response=await refreshPage.goto(base+"/");await refreshPage.waitForURL("**/cloud");await refreshPage.getByRole("button",{name:"查看 Cloud Widget 详情"}).waitFor();
    assert((await refresh.cookies()).some(c=>c.name.startsWith("sb-localhost-auth-token")&&c.value!==oldCookie));assert((response.headers()["cache-control"]||"").includes("no-store"));console.log("PASS proxy refresh cookie survives server redirect with private/no-store response");
    assert.deepEqual(errors,[]);assert(fixture.requests.some(r=>r.path==="/auth/v1/user"));
    console.log("PASS full cloud-only browser regression; all API writes were local mocks");
  }catch(err){if(diagnosticPage)console.error("Browser diagnostics",diagnosticPage.url(),await diagnosticPage.locator("body").innerText(),errors);throw err;}
  finally{await browser?.close();server?.kill();await new Promise(r=>fixture.server.close(r));}
})().catch(err=>{console.error(err);process.exitCode=1;});
