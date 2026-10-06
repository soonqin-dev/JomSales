// Local-only API double reachable by BOTH Next server/proxy and the browser.
// Real database authorization is separately exercised by workspace-rls.test.cjs.
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const uuid = n => `50000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function createFixture(port=54329) {
  const origin=`http://localhost:${port}`,CA=uuid(10),CB=uuid(11);
  const users=Object.fromEntries(["owner","sales","peer","other","disabled","new"].map((key,i)=>[key,{id:uuid(i+1),email:`${key}@example.test`,aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString()}]));
  const profiles=new Map(Object.entries(users).map(([key,u])=>[u.id,{user_id:u.id,display_name:key+' Name',whatsapp:'+60123456789',revision:1}]));
  const categories=[];
  const companies=[{id:CA,name:"Company A",contact:"A phone",logo_path:null,brand_revision:1},{id:CB,name:"Company B",contact:"B phone",logo_path:null,brand_revision:1}];
  const members=Object.entries(users).filter(([key])=>key!=="new").map(([key,user])=>({company_id:key==="other"?CB:CA,user_id:user.id,role:["owner","other"].includes(key)?"admin":"sales",is_primary:["owner","other"].includes(key),active:key!=="disabled",can_manage_products:false}));
  const image=`${CA}/${uuid(20)}/${uuid(30)}.png`;
  const products=[{id:uuid(20),company_id:CA,serial:"P-001",name:"Cloud Widget",tags:["Tools"],price:12.5,image_path:image,revision:1,source_key:null,deleted_at:null,created_at:new Date().toISOString()},
    {id:uuid(21),company_id:CB,serial:"B-001",name:"Company B only",tags:[],price:20,image_path:null,revision:1,source_key:null,deleted_at:null,created_at:new Date().toISOString()}];
  const quotations=[],files=new Set([image]),tokens=new Map(),refreshTokens=new Map(),requests=[];
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZHkAAAAASUVORK5CYII=","base64");
  const state={failQuote:false,failBrand:false,failSign:false,failImport:false,failProductReply:false};
  const numbering=new Map(),reservations=new Map(),importResults=new Map();
  const quoteDefaults=new Map(),quoteSequences=new Map(),customers=[],events=[];
  const defaults=co=>{if(!quoteDefaults.has(co))quoteDefaults.set(co,{company_id:co,prefix:"Q",digits:5,validity_days:14,payment_terms:"",notes:"",revision:1});return quoteDefaults.get(co);};
  const amount=q=>(q.items.reduce((sum,line)=>sum+Number((BigInt(Math.round(line.unitPrice*100))*BigInt(Math.round(line.quantity*1000))+500n)/1000n),0)-Math.round(Number(q.discount)*100))/100;
  function event(q,action){events.push({id:randomUUID(),quote_id:q.id,company_id:q.company_id,actor:currentActor,action,details:{status:q.status,actor_email:Object.values(users).find(u=>u.id===currentActor)?.email,number:q.number,total:String(q.total_amount)},created_at:new Date().toISOString()});}
  let currentActor=null;
  const numberSettings=co=>{if(!numbering.has(co))numbering.set(co,{company_id:co,automatic:true,prefix:"P-",digits:5,next_number:1,revision:1});return numbering.get(co);};
  function session(user) {
    const access_token=`${encode({alg:"HS256",typ:"JWT"})}.${encode({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:"authenticated"})}.${randomUUID()}`;
    const refresh_token=randomUUID();tokens.set(access_token,user);refreshTokens.set(refresh_token,user);
    return {user,access_token,refresh_token,expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:"bearer"};
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Headers","*");res.setHeader("Access-Control-Allow-Methods","GET,POST,PATCH,DELETE,OPTIONS");res.setHeader("Access-Control-Expose-Headers","Content-Range");
    if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
    const url=new URL(req.url,origin),path=url.pathname,method=req.method;
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();
    let body={};try{body=JSON.parse(raw||"{}");}catch{}
    const user=tokens.get(req.headers.authorization?.replace(/^Bearer /,""));
    currentActor=user?.id||null;
    const own=members.filter(m=>m.user_id===user?.id&&m.active),member=co=>own.find(m=>m.company_id===co);
    const writer=co=>member(co)?.role==="admin"||member(co)?.can_manage_products===true;
    const eq=k=>url.searchParams.get(k)?.replace(/^eq\./,"");
    const match=row=>[...url.searchParams].every(([key,v])=>v==="is.null"?row[key]==null:v==="not.is.null"?row[key]!=null:!v.startsWith("eq.")||String(row[key])===v.slice(3));
    let data={},status=200;requests.push({path,method,user:user?.id});
    try {
      if(path==="/auth/v1/token") {
        const target=url.searchParams.get("grant_type")==="refresh_token"?refreshTokens.get(body.refresh_token):Object.values(users).find(u=>u.email===body.email);
        if(target)data=session(target);else{status=400;data={error:"invalid_grant",message:"Unknown fixture user"};}
      } else if(path==="/auth/v1/user") {if(user)data=user;else{status=401;data={message:"Invalid issued token"};}}
      else if(path==="/auth/v1/logout") {if(user)tokens.delete(req.headers.authorization.replace(/^Bearer /,""));data={};}
      else if(path==="/rest/v1/company_members") data=own.filter(match).map(m=>({...m,companies:companies.find(c=>c.id===m.company_id)}));
      else if(path==='/rest/v1/account_profiles')data=[profiles.get(user?.id)].filter(Boolean);
      else if(path==='/rest/v1/rpc/save_account_profile'){
        const p=profiles.get(user?.id);if(!p||p.revision!==body.expected_revision)throw Error('Profile changed');Object.assign(p,{display_name:body.profile_name,whatsapp:body.work_whatsapp,revision:p.revision+1});data=p;
      }
      else if(path==="/rest/v1/companies") data=companies.filter(c=>member(c.id)&&match(c));
      else if(path==="/rest/v1/customers"){
        const visible=customers.filter(c=>member(c.company_id)&&(member(c.company_id).role==="admin"||c.created_by===user.id)&&match(c));
        if(method==="POST"){
          if(!member(body.company_id))throw Error("Customer access denied");if(customers.some(c=>c.id===body.id))throw Error("Duplicate customer");
          const row={...body,created_by:user.id,active:true,revision:1,created_at:new Date().toISOString()};customers.unshift(row);data=[row];
        }else if(method==="PATCH")data=visible.filter(c=>c.created_by===user.id).map(c=>Object.assign(c,body,{revision:c.revision+1}));
        else data=visible;
      }else if(path==="/rest/v1/quotation_events")data=events.filter(e=>member(e.company_id)&&(member(e.company_id).role==="admin"||quotations.find(q=>q.id===e.quote_id)?.created_by===user.id)&&match(e));
      else if(path==="/rest/v1/products") {
        let matching=products.filter(p=>member(p.company_id)&&match(p)&&(url.searchParams.get("deleted_at")!=="is.null"||!p.deleted_at));
        if(method==="POST") {
          if(!writer(body.company_id)||(body.source_key&&member(body.company_id)?.role!=="admin"))throw Error("Permission denied");
          if(products.some(p=>p.id===body.id||(!p.deleted_at&&p.company_id===body.company_id&&p.serial===body.serial)))throw Error("Duplicate product");
          const row={unit:"件",category:"",description:"",is_service:false,...body,price:Number(body.price),revision:1,deleted_at:null,created_at:new Date().toISOString()};products.unshift(row);data=[row];
          if(state.failProductReply){state.failProductReply=false;throw Error("Simulated lost product reply");}
        } else if(method==="PATCH")data=matching.filter(p=>writer(p.company_id)).map(p=>Object.assign(p,body,{revision:p.revision+1}));
        else data=matching;
      } else if(path==="/rest/v1/quotations") {
        let matching=quotations.filter(q=>member(q.company_id)&&(member(q.company_id).role==="admin"||q.created_by===user.id)&&(!q.deleted_at||Date.parse(q.deleted_at)>Date.now()-15*86400000)&&match(q));
        if(method!=="GET"&&state.failQuote){state.failQuote=false;throw Error("Simulated quote save failure");}
        if(method==="POST") {
          if(!member(body.company_id))throw Error("Permission denied");
          if(quotations.some(q=>q.id===body.id||(body.source_key&&q.source_key===body.source_key&&q.company_id===body.company_id&&q.created_by===user.id)))throw Error("Duplicate quote");
          const co=companies.find(c=>c.id===body.company_id),row={...body,created_by:user.id,creator_email:user.email,status:"pending",deleted_at:null,company_snapshot:{name:co.name,contact:co.contact,logo_path:co.logo_path},revision:1,updated_at:new Date().toISOString(),created_at:new Date().toISOString()};quotations.unshift(row);data=[row];
        }else if(method==="PATCH")data=matching.filter(q=>!q.deleted_at).map(q=>{Object.assign(q,body,{revision:q.revision+1,updated_at:new Date().toISOString()});q.total_amount=amount(q).toFixed(2);event(q,"edited");return q;});
        else data=matching.sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
      } else if(path==="/rest/v1/rpc/is_platform_admin")data=false;
      else if(path==="/rest/v1/rpc/get_quotation_defaults"){if(!member(body.target_company))throw Error("Company access denied");data=defaults(body.target_company);}
      else if(path==="/rest/v1/rpc/save_quotation_defaults"){
        if(member(body.target_company)?.role!=="admin")throw Error("Administrator access required");const row=defaults(body.target_company);
        if(row.revision!==body.expected_revision)throw Error("Settings changed");data=Object.assign(row,{prefix:body.number_prefix,digits:body.number_digits,validity_days:body.valid_days,payment_terms:body.payment_text,notes:body.default_notes,revision:row.revision+1});
      }else if(path==="/rest/v1/rpc/search_company_customers"){
        if(!member(body.target_company))throw Error("Company access denied");const visible=customers.filter(c=>c.company_id===body.target_company&&(member(c.company_id).role==="admin"||c.created_by===user.id)&&(body.include_inactive||c.active)).map(c=>({...c,owner_name:profiles.get(c.created_by)?.display_name||'',owner_email:Object.values(users).find(u=>u.id===c.created_by)?.email||''})).filter(c=>[c.name,c.company,c.phone,c.email,c.owner_name,c.owner_email].join(" ").toLowerCase().includes(body.search_text.toLowerCase()));data={items:visible.slice(body.page_offset,body.page_offset+50),total:visible.length};
      }else if(path==="/rest/v1/rpc/create_quotation"){
        if(state.failQuote){state.failQuote=false;throw Error("Simulated quote save failure");}
        if(!member(body.target_company))throw Error("Company access denied");
        const existing=quotations.find(q=>q.id===body.target_quote);
        if(existing){if(existing.company_id!==body.target_company||existing.created_by!==user.id)throw Error("Quote unavailable");data=existing;}
        else{const co=companies.find(c=>c.id===body.target_company),p=body.payload,d=defaults(co.id),key=co.id+p.quote_date.slice(0,4),seq=(quoteSequences.get(key)||0)+1;quoteSequences.set(key,seq);
          const row={...p,id:body.target_quote,company_id:co.id,created_by:user.id,creator_email:user.email,status:"pending",deleted_at:null,confirmed_at:null,paid_at:null,number:`${d.prefix}-${p.quote_date.slice(0,4)}-${String(seq).padStart(d.digits,"0")}`,company_snapshot:{name:co.name,contact:co.contact,logo_path:co.logo_path},revision:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};row.total_amount=amount(row).toFixed(2);quotations.unshift(row);event(row,"created");data=row;}
      }else if(path==="/rest/v1/rpc/company_sales_report"){
        if(member(body.target_company)?.role!=="admin")throw Error("Administrator access required");
        const begin=Date.parse(body.start_date+"T00:00:00+08:00"),finish=Date.parse(body.end_date+"T23:59:59.999+08:00"),inRange=date=>date&&Date.parse(date)>=begin&&Date.parse(date)<=finish;
        const rows=members.filter(m=>m.company_id===body.target_company).map(m=>{const own=quotations.filter(q=>q.company_id===m.company_id&&q.created_by===m.user_id&&!q.deleted_at),won=own.filter(q=>["success","paid"].includes(q.status)&&inRange(q.confirmed_at)),paid=own.filter(q=>q.status==="paid"&&inRange(q.paid_at));const goods=new Map();
          for(const q of won)for(const line of q.items)if(line.product.is_service===false)goods.set(line.product.unit,(goods.get(line.product.unit)||0)+line.quantity);
          const u=Object.values(users).find(u=>u.id===m.user_id);return{...m,name:u.email,email:u.email,quote_count:own.filter(q=>inRange(q.created_at)).length,confirmed_count:won.length,confirmed_amount:won.reduce((sum,q)=>sum+amount(q),0).toFixed(2),paid_amount:paid.reduce((sum,q)=>sum+amount(q),0).toFixed(2),goods:[...goods].map(([unit,quantity])=>({unit,quantity:String(quantity)}))};});data={rows:rows.sort((a,b)=>Number(b.confirmed_amount)-Number(a.confirmed_amount)),legacy_undated:0};
      }
      else if(path==='/rest/v1/rpc/search_company_quotations'){
        if(!member(body.target_company))throw Error('Company access denied');const term=body.search_text.toLowerCase();
        const rows=quotations.filter(q=>q.company_id===body.target_company&&(member(q.company_id).role==='admin'||q.created_by===user.id)&&!!q.deleted_at===body.in_trash&&(body.filter_status==='all'||q.status===body.filter_status)&&[q.number,q.customer_name,q.creator_name,q.creator_email].some(v=>(v||'').toLowerCase().includes(term)))
          .filter(q=>!body.after_updated||q.updated_at<body.after_updated||(q.updated_at===body.after_updated&&q.id>body.after_id)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id));
        const items=rows.slice(0,50);data={items,has_more:rows.length>50,cursor:items.length?{updated_at:items.at(-1).updated_at,id:items.at(-1).id}:null};
      }
      else if(path==='/rest/v1/rpc/list_company_categories'){
        if(!member(body.target_company))throw Error('Company access denied');for(const p of products.filter(p=>p.company_id===body.target_company&&p.category))if(!categories.some(c=>c.company_id===p.company_id&&c.name.toLowerCase()===p.category.trim().toLowerCase()))categories.push({id:randomUUID(),company_id:p.company_id,name:p.category.trim(),active:true,revision:1});
        data=categories.filter(c=>c.company_id===body.target_company).map(c=>({...c,product_count:products.filter(p=>p.company_id===c.company_id&&!p.deleted_at&&(p.category||'').toLowerCase()===c.name.toLowerCase()).length}));
      }else if(path==='/rest/v1/rpc/manage_company_category'){
        if(member(body.target_company)?.role!=='admin')throw Error('Administrator required');let row=categories.find(c=>c.company_id===body.target_company&&c.id===body.target_category);
        if(body.action==='create'){if(!row){if(categories.some(c=>c.company_id===body.target_company&&c.name.toLowerCase()===body.category_name.toLowerCase()))throw Error('Duplicate category');row={id:body.target_category,company_id:body.target_company,name:body.category_name,active:true,revision:1};categories.push(row);}}
        else{if(!row||row.revision!==body.expected_revision)throw Error('Category changed');if(body.action==='rename'){for(const p of products.filter(p=>p.company_id===row.company_id&&(p.category||'').toLowerCase()===row.name.toLowerCase())){p.category=body.category_name;p.revision++;}row.name=body.category_name;}else row.active=body.action==='restore';row.revision++;}data=row;
      }
      else if(path==="/rest/v1/rpc/search_company_products") {
        if(!member(body.target_company))throw Error("Company access denied");
        if(body.search_text==="slow")await new Promise(resolve=>setTimeout(resolve,800));
        const matches=products.filter(p=>p.company_id===body.target_company&&!p.deleted_at&&(body.category_filter==null||(p.category||'').trim().toLowerCase()===body.category_filter.trim().toLowerCase())&&[p.serial,p.name,p.category,p.description,...(p.tags||[])].join(" ").toLowerCase().includes(body.search_text.toLowerCase()))
          .sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
        const after=matches.filter(p=>!body.after_created||p.created_at<body.after_created||(p.created_at===body.after_created&&p.id>body.after_id));
        const items=after.slice(0,50);data={items,total:matches.length,has_more:after.length>50,cursor:items.length?{id:items.at(-1).id,created_at:items.at(-1).created_at}:null};
      } else if(path==="/rest/v1/rpc/get_product_number_settings") {
        if(member(body.target_company)?.role!=="admin")throw Error("Administrator access required");data=numberSettings(body.target_company);
      } else if(path==="/rest/v1/rpc/save_product_number_settings") {
        if(member(body.target_company)?.role!=="admin")throw Error("Administrator access required");
        const settings=numberSettings(body.target_company);if(settings.revision!==body.expected_revision)throw Error("Settings changed");
        data=Object.assign(settings,{automatic:body.auto_number,prefix:body.number_prefix,digits:body.number_digits,next_number:body.next_value,revision:settings.revision+1});
      } else if(path==="/rest/v1/rpc/reserve_product_number") {
        if(!writer(body.target_company))throw Error("Product permission required");
        if(reservations.has(body.target_product))data=reservations.get(body.target_product);
        else{const settings=numberSettings(body.target_company);if(!settings.automatic)throw Error("Automatic numbering disabled");
          do{data=settings.prefix+String(settings.next_number++).padStart(settings.digits,"0");}while(products.some(p=>p.company_id===body.target_company&&p.serial===data)||[...reservations.values()].includes(data));
          settings.revision++;reservations.set(body.target_product,data);}
      } else if(path==="/rest/v1/rpc/check_product_import_codes") {
        if(member(body.target_company)?.role!=="admin")throw Error("Administrator access required");
        data=products.filter(p=>p.company_id===body.target_company&&!p.deleted_at&&body.codes.map(v=>v.toLowerCase()).includes(p.serial.toLowerCase())).map(p=>p.serial.toLowerCase());
      } else if(path==="/rest/v1/rpc/import_products_batch") {
        if(member(body.target_company)?.role!=="admin")throw Error("Administrator access required");
        data=body.entries.map(entry=>{
          const key=body.target_company+body.import_key+entry.row_number;
          if(importResults.has(key))return {...importResults.get(key),replayed:true};
          if(products.some(p=>p.company_id===body.target_company&&!p.deleted_at&&p.serial.toLowerCase()===entry.serial.toLowerCase()))return {row_number:entry.row_number,status:"duplicate"};
          const product_id=randomUUID();products.unshift({...entry,id:product_id,company_id:body.target_company,price:Number(entry.price),revision:1,image_path:null,thumbnail_path:null,deleted_at:null,created_at:new Date().toISOString()});
          const result={row_number:entry.row_number,status:"imported",product_id,replayed:false};importResults.set(key,result);return result;
        });
        if(state.failImport){state.failImport=false;throw Error("Simulated lost import reply");}
      } else if(path==="/rest/v1/rpc/manage_quotation") {
        const q=quotations.find(q=>q.id===body.target_quote&&q.company_id===body.target_company),m=member(body.target_company);
        if(!q||!m||(m.role!=="admin"&&q.created_by!==user.id))throw Error("Quotation access denied");
        if(q.revision!==body.expected_revision)throw Error("Quotation changed. Refresh before retrying.");
        if(body.action==="restore") {
          if(!q.deleted_at||Date.parse(q.deleted_at)<=Date.now()-15*86400000)throw Error("Quotation is not recoverable");
          q.deleted_at=null;
        } else {
          if(q.deleted_at)throw Error("Restore quotation before editing");
          if(body.action==="trash")q.deleted_at=new Date().toISOString();
          else if(["pending","success","paid"].includes(body.action)){q.status=body.action;if(body.action==="pending"){q.confirmed_at=null;q.paid_at=null;}else{q.confirmed_at||=new Date().toISOString();q.paid_at=body.action==="paid"?new Date().toISOString():null;}}
          else throw Error("Invalid quotation action");
        }
        data=Object.assign(q,{revision:q.revision+1,updated_at:new Date().toISOString()});event(q,body.action);
      } else if(path==="/rest/v1/rpc/save_company_brand") {
        if(state.failBrand){state.failBrand=false;throw Error("Simulated brand save failure");}
        const co=companies.find(c=>c.id===body.target_company);
        if(member(co?.id)?.role!=="admin"||co.brand_revision!==body.expected_revision)throw Error("Permission/revision conflict");
        data=Object.assign(co,{name:body.company_name,contact:body.company_contact,logo_path:body.new_logo_path,brand_revision:co.brand_revision+1});
      } else if(["/rest/v1/rpc/get_company_team_permissions","/rest/v1/rpc/get_company_roster"].includes(path)) {
        if(member(body.target_company)?.role!=="admin")throw Error("Permission denied");
        data=members.filter(m=>m.company_id===body.target_company).map(m=>({...m,email:Object.values(users).find(u=>u.id===m.user_id).email}));
      } else if(path==="/rest/v1/rpc/get_company_invitations")data=[];
      else if(path.startsWith("/storage/v1/object/sign/")) {
        const suffix=path.slice("/storage/v1/object/sign/".length),[bucket,...segments]=suffix.split("/"),file=segments.join("/");
        if(method==="GET") {res.writeHead(200,{"Content-Type":"image/png"});res.end(png);return;}
        const sign=p=>({path:p,signedURL:`/object/sign/${bucket}/${p}?token=fixture`,error:state.failSign||!member(p.split("/")[0])||!files.has(p)?"Denied":null});
        if(body.paths)data=body.paths.map(sign);
        else {const result=sign(file);if(result.error)throw Error(result.error);data={signedURL:result.signedURL};}
      } else if(path.startsWith("/storage/v1/object/")) {
        const suffix=path.slice("/storage/v1/object/".length),[bucket,...segments]=suffix.split("/"),file=segments.join("/");
        if(method==="POST") {
          const co=file.split("/")[0];if(bucket==="salesgo-branding"?member(co)?.role!=="admin":!writer(co))throw Error("Permission denied");
          if(files.has(file)||req.headers["x-upsert"]!=="false")throw Error("Overwrite denied");files.add(file);data={Key:`${bucket}/${file}`,Id:randomUUID()};
        } else if(method==="DELETE")data=(body.prefixes||[]).filter(p=>member(p.split("/")[0])?.role==="admin"&&!companies.some(c=>c.logo_path===p)&&!quotations.some(q=>q.company_snapshot.logo_path===p)&&!products.some(p2=>p2.image_path===p&&!p2.deleted_at)).map(p=>{files.delete(p);return {name:p};});
        else throw Error("Unexpected storage request");
      } else throw Error(`Unexpected fixture request ${method} ${path}`);
      if(Array.isArray(data)) {
        const offset=Number(url.searchParams.get("offset")||0),limit=Number(url.searchParams.get("limit")||1000);data=data.slice(offset,offset+limit);
        if(req.headers.accept?.includes("application/vnd.pgrst.object+json"))data=data[0]||null;
      }
    } catch(err) {status=400;data={message:err.message,code:"FIXTURE"};}
    res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(data));
  });
  return {server,origin,users,companies,members,products,quotations,customers,profiles,categories,events,state,png,requests,session,CA,CB};
}
module.exports={createFixture};
