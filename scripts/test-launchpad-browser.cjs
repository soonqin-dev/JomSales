// Local API fixture + real mobile Chromium. No real Supabase accounts or email.
const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.SALESGO_PLAYWRIGHT_MODULE || "playwright");
const base="http://localhost:54348", origin="http://127.0.0.1:54347";
const uuid=n=>`90000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
const users=Object.fromEntries(["platform","owner","sales","waiting"].map((key,i)=>[key,{id:uuid(i+1),email:`${key}@fixture.example`,aud:"authenticated",role:"authenticated",email_confirmed_at:new Date().toISOString(),user_metadata:{},app_metadata:{},factors:[],created_at:new Date().toISOString()}]));
const profiles=Object.fromEntries(Object.values(users).map(user=>[user.id,{user_id:user.id,display_name:"",whatsapp:"",revision:1}]));
const co=uuid(10), companies=[{id:co,name:"Fixture Company",service_state:"active",service_until:null,access_revision:1,plan:"Lite",employee_limit:null,product_limit:null,storage_limit_mb:null,features:{},admin_email:users.owner.email,members:2,products:0,storage_bytes:0}];
const roster=[{user_id:users.owner.id,email:users.owner.email,role:"admin",is_primary:true,active:true,removed_at:null},{user_id:users.sales.id,email:users.sales.email,role:"sales",is_primary:false,active:true,removed_at:null,can_manage_products:false}];
const invitations=[],errors=[];let recoverCalls=0,lostCreate=true,failProfile=false,configured=false;
const session=user=>({user,access_token:`${encode({alg:"HS256",typ:"JWT"})}.${encode({sub:user.id,role:"authenticated",aal:"aal1",exp:Math.floor(Date.now()/1000)+3600})}.fixture`,refresh_token:`refresh-${user.id}`,expires_in:3600,token_type:"bearer"});
function auth(req){try{const sub=JSON.parse(Buffer.from(req.headers.authorization.split(" ")[1].split(".")[1],"base64url")).sub;return Object.values(users).find(u=>u.id===sub)||null;}catch{return null;}}
const fixture=createServer(async(req,res)=>{
  res.setHeader("Access-Control-Allow-Origin",base);res.setHeader("Access-Control-Allow-Headers","*");res.setHeader("Access-Control-Allow-Methods","GET,POST,PUT,DELETE,OPTIONS");
  if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
  const url=new URL(req.url,origin);let raw="";for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  const user=auth(req), path=url.pathname;let data={},status=200;
  try{
    if(path==="/auth/v1/token"){
      const found=Object.values(users).find(u=>u.email===body.email);
      if(found&&body.password==="fixture-password")data=session(found);else{status=400;data={msg:"Invalid credentials"};}
    }else if(path==="/auth/v1/signup"){
      assert.equal(body.data.display_name,"新员工");data={...users.waiting,user_metadata:body.data};
    }else if(path==="/auth/v1/recover"){recoverCalls++;assert.equal(url.searchParams.get("redirect_to"),base+"/auth/reset");}
    else if(path==="/auth/v1/logout")data={};
    else if(path==="/auth/v1/user"){
      if(!user){status=401;data={msg:"No session"};}
      else if(req.method==="PUT"){if(body.email){user.new_email=body.email;assert.equal(url.searchParams.get("redirect_to"),base+"/auth/callback?next=settings");}data=user;}
      else data=user;
    }else if(path==="/rest/v1/company_members"){
      data=roster.filter(m=>m.user_id===user?.id&&m.active&&!m.removed_at).map(m=>({...m,company_id:co,companies:{id:co,name:companies[0].name}}));
      if(req.headers.accept?.includes("vnd.pgrst.object"))data=data[0]||null;
    }else if(path==="/rest/v1/companies")data={id:co,name:companies[0].name,contact:"",logo_path:null,brand_revision:1};
    else if(path==="/rest/v1/products"||path==="/rest/v1/quotations")data=[];
    else if(path==="/rest/v1/account_profiles")data=profiles[user?.id]||null;
    else if(path.startsWith("/rest/v1/rpc/")){
      const method=path.split("/").pop();
      if(method.startsWith("platform_")&&user?.id!==users.platform.id){status=403;data={message:"Platform administrator access required."};}
      else if(method==="is_platform_admin")data=user?.id===users.platform.id;
      else if(method==="save_account_profile"){
        if(failProfile){failProfile=false;status=409;data={message:"Profile changed. Reload before saving."};}
        else{assert.equal(body.expected_revision,profiles[user.id].revision);profiles[user.id]={...profiles[user.id],display_name:body.profile_name,whatsapp:body.work_whatsapp,revision:profiles[user.id].revision+1};data=profiles[user.id];}
      }else if(method==="get_company_roster")data=roster.map(m=>({...m,display_name:profiles[m.user_id].display_name}));
      else if(method==="get_company_invitations")data=[];
      else if(method==="manage_company_member"){
        const member=roster.find(m=>m.user_id===body.employee_id);assert(!member.is_primary);
        if(body.action==="promote")member.role="admin";else if(body.action==="demote")member.role="sales";
        else if(body.action==="disable")member.active=false;else if(body.action==="enable")member.active=true;
        else if(body.action==="remove"){member.active=false;member.removed_at=new Date().toISOString();}data=null;
      }else if(method==="platform_list_companies")data=companies.slice(body.page_offset,body.page_offset+50);
      else if(method==="platform_company_members")data=body.target_company===co?roster:[];
      else if(method==="platform_audit_list")data=[];
      else if(method==="platform_create_company"){
        const existing=companies.find(c=>c.id===body.target_company);
        if(!existing){companies.push({...companies[0],id:body.target_company,name:body.company_name,admin_email:null,members:0});invitations.push({...body});}
        else assert.equal(invitations[0].invite_token,body.invite_token,"lost response must retry same token");
        if(lostCreate){lostCreate=false;status=500;data={message:"Simulated lost create reply"};}else data=body.target_company;
      }else if(method==="platform_update_company"){
        assert.equal(body.expected_revision,companies[0].access_revision);assert.equal(body.new_plan,"Pro");assert.equal(body.seats,5);configured=true;data=null;
      }else if(method==="get_join_invitation")data=[{company_id:co,company_name:"Invited Company",email:user.email,expires_at:new Date(Date.now()+86400000).toISOString(),already_accepted:false,invite_role:"primary"}];
      else throw new Error(`Unexpected RPC ${method}`);
    }else throw new Error(`Unexpected fixture path ${path}`);
  }catch(err){errors.push(err.message);status=500;data={message:err.message};}
  res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(data));
});
let server,browser;
const next=join(__dirname,"../node_modules/next/dist/bin/next");
const env={...process.env,JOMSALES_BUILD_DIR:`.next-launchpad-browser-${process.pid}`,NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_local_fixture_only"};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  try{
    await new Promise(resolve=>fixture.listen(54347,"127.0.0.1",resolve));
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[next,"build"],{env,stdio:"inherit"});child.on("error",reject);child.on("exit",code=>code?reject(Error(`Build failed ${code}`)):resolve());});
    server=spawn(process.execPath,[next,"start","-p","54348"],{env,stdio:"inherit"});
    for(let i=0;i<100;i++){try{if((await fetch(base+"/account")).ok)break;}catch{}await wait(200);}
    browser=await chromium.launch({channel:process.env.SALESGO_BROWSER_CHANNEL||"msedge",headless:true});
    async function open(key){
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
      page.on("pageerror",err=>errors.push(err.message));page.on("dialog",dialog=>dialog.accept());
      await page.goto(base+"/account");await page.getByLabel("邮箱",{exact:true}).fill(users[key].email);await page.getByLabel("密码",{exact:true}).fill("fixture-password");await page.getByRole("button",{name:"登录",exact:true}).last().click();
      if(["owner","sales"].includes(key)){await page.getByRole("heading",{name:"公司云端产品",exact:true}).waitFor();await page.goto(base+"/account");}
      await page.getByRole("heading",{name:"已登录",exact:true}).waitFor();return{context,page};
    }
    const waiting=await open("waiting");
    assert.equal(await waiting.page.getByRole("button",{name:"创建公司",exact:true}).count(),0);
    await waiting.page.getByText(/等待公司邀请/).waitFor();
    await waiting.page.goto(base+"/platform");await waiting.page.getByRole("alert").filter({hasText:"没有平台权限"}).waitFor();
    assert.equal(await waiting.page.getByRole("button",{name:"开通并生成管理员邀请",exact:true}).count(),0);
    console.log("PASS employee-only registration landing and denied platform UI");
    const owner=await open("owner"),page=owner.page;
    assert.equal(await page.getByRole("link",{name:"平台管理后台",exact:true}).count(),0);
    await page.getByRole("link",{name:"个人设置",exact:true}).click();await page.getByLabel("显示姓名",{exact:true}).waitFor();
    await page.getByLabel("显示姓名",{exact:true}).fill("管理员甲");await page.getByLabel(/工作 WhatsApp/).fill("+60 12-345 6789");
    await page.getByRole("button",{name:"保存个人资料",exact:true}).click();await page.getByRole("status").filter({hasText:"个人资料已保存"}).waitFor();assert.equal(profiles[users.owner.id].whatsapp,"+60123456789");
    failProfile=true;await page.getByLabel("显示姓名",{exact:true}).fill("未保存的姓名");await page.getByRole("button",{name:"保存个人资料",exact:true}).click();await page.getByRole("alert").filter({hasText:"Profile changed"}).waitFor();assert.equal(await page.getByLabel("显示姓名",{exact:true}).inputValue(),"未保存的姓名");
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByLabel("当前密码（修改密码／邮箱前填写）").fill("fixture-password");await page.getByLabel("新登录邮箱").fill("changed@fixture.example");await page.getByRole("button",{name:"验证并更改邮箱",exact:true}).click();await page.getByRole("status").filter({hasText:"邮箱更改申请已提交"}).waitFor();assert.equal(users.owner.email,"owner@fixture.example");
    console.log("PASS personal profile save/failure retention, pending email verification and mobile layout");
    await page.goto(base+"/team?company="+co);await page.getByRole("heading",{name:"Fixture Company",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"移除员工",exact:true}).count(),1,"primary cannot remove self");
    await page.getByRole("button",{name:"设为副管理员",exact:true}).click();await page.getByRole("button",{name:"撤销副管理员",exact:true}).waitFor();
    await page.getByRole("button",{name:"撤销副管理员",exact:true}).click();await page.getByRole("button",{name:"移除员工",exact:true}).click();await page.getByText(/已移除/).waitFor();assert(roster[1].removed_at);assert.equal(await page.getByRole("button",{name:"恢复员工",exact:true}).count(),0);
    console.log("PASS primary/deputy and member-removal UI");
    const platform=await open("platform"),admin=platform.page;
    await admin.getByRole("link",{name:"平台管理后台",exact:true}).click();await admin.getByLabel("公司名称",{exact:true}).fill("New fixture company");await admin.getByLabel("正管理员邮箱",{exact:true}).fill("new-admin@fixture.example");await admin.getByRole("button",{name:"开通并生成管理员邀请",exact:true}).click();await admin.getByRole("alert").filter({hasText:"Simulated lost create reply"}).waitFor();
    await admin.getByRole("button",{name:"开通并生成管理员邀请",exact:true}).click();await admin.getByLabel("管理员邀请链接").waitFor();assert.equal(invitations.length,1);assert.equal(companies.length,2);
    const link=await admin.getByLabel("管理员邀请链接").inputValue();assert.match(link,/\/join#token=[0-9a-f]{64}$/);
    await admin.locator(".teamRow").filter({has:admin.getByText("Fixture Company",{exact:true})}).getByRole("button",{name:"管理公司",exact:true}).click();await admin.getByLabel("配套",{exact:true}).selectOption("Pro");await admin.getByLabel(/成员额度/).fill("5");await admin.getByRole("button",{name:"保存公司设置",exact:true}).click();await admin.getByRole("status").filter({hasText:"公司设置已保存"}).waitFor();assert(configured);
    assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log("PASS platform provisioning/retry, plan settings and mobile layout");
    await waiting.page.goto(base+"/join#token="+"a".repeat(64));await waiting.page.getByText("角色：正管理员（由平台开通）",{exact:true}).waitFor();
    const anonymous=await browser.newContext({viewport:{width:390,height:844}}),anon=await anonymous.newPage();
    await anon.goto(base+"/account");await anon.getByLabel("邮箱",{exact:true}).fill("waiting@fixture.example");await anon.getByRole("button",{name:"忘记密码",exact:true}).click();await anon.getByRole("status").filter({hasText:"重置邮件"}).waitFor();assert.equal(recoverCalls,1);
    await anon.goto(base+"/auth/reset?error=expired");await anon.getByRole("alert").filter({hasText:"链接失效"}).waitFor();assert.equal(await anon.getByRole("button",{name:"设置密码并退出登录",exact:true}).count(),0);
    await anon.goto(base+"/account");await anon.getByRole("button",{name:"注册员工账号",exact:true}).click();await anon.getByLabel("显示姓名",{exact:true}).fill("新员工");await anon.getByLabel("邮箱",{exact:true}).fill("new@fixture.example");await anon.getByLabel("密码（至少 12 个字符）",{exact:true}).fill("fixture-password");await anon.getByRole("button",{name:"注册并验证邮箱",exact:true}).click();await anon.getByRole("status").filter({hasText:"注册申请已提交"}).waitFor();
    console.log("PASS primary invite label, password recovery, expired-link rejection and signup name");
    assert.deepEqual(errors,[]);console.log("PASS no browser runtime or unexpected API errors");
  }finally{await browser?.close();server?.kill();await new Promise(resolve=>fixture.close(resolve));}
})().catch(err=>{console.error(err);process.exitCode=1;});
