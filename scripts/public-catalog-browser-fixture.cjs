// Local API double. Real authorization is tested separately against PostgreSQL.
const {createFixture}=require("./workspace-browser-fixture.cjs");
function createCatalogFixture(port){
  const f=createFixture(port),original=f.server.listeners("request")[0],links=[],profiles=f.profiles;
  profiles.get(f.users.peer.id).whatsapp='';
  const state={lostReply:false},secret="sb_secret_local_catalog_fixture_only",catalogRequests=[];
  const uuid=n=>`60000000-0000-4000-a000-${String(n).padStart(12,"0")}`;
  f.products[0].catalog_public=false;
  for(let n=1;n<=60;n++)f.products.push({id:uuid(n),company_id:f.CA,serial:`CAT-${String(n).padStart(3,"0")}`,name:`Catalog part ${n}`,catalog_public:false,price:199.93,tags:[],unit:"件",category:"Parts",description:n===1?"100%_safe":"Product description",is_service:false,deleted_at:null,revision:1,created_at:"2026-01-01T00:00:00.000Z",image_path:null});
  const now=()=>new Date().toISOString();
  const member=(co,user)=>f.members.find(m=>m.company_id===co&&m.user_id===user&&m.active);
  const live=token=>links.find(l=>l.token===token&&!l.revoked_at&&Date.parse(l.expires_at)>Date.now()&&member(l.company_id,l.created_by)&&profiles.get(l.created_by)?.whatsapp===l.whatsapp);
  const visible=(l,p)=>p.company_id===l.company_id&&p.catalog_public&&!p.deleted_at&&(l.scope==="all"||l.product_ids.includes(p.id));
  const page=(rows,cursor)=>rows.filter(p=>!cursor||p.created_at<cursor.created_at||(p.created_at===cursor.created_at&&p.id>cursor.id)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
  const shaped=(rows)=>({items:rows.slice(0,30),has_more:rows.length>30,cursor:rows.length?{id:rows[Math.min(29,rows.length-1)].id,created_at:rows[Math.min(29,rows.length-1)].created_at}:null});
  f.server.removeListener("request",original);
  f.server.on("request",async(req,res)=>{
    const url=new URL(req.url,f.origin),path=url.pathname,newRpc=["search_catalog_share_products","set_product_catalog_visibility","set_catalog_visibility_batch","create_catalog_link","revoke_catalog_link","read_public_catalog","public_catalog_image","public_catalog_inquiry"].includes(path.split("/").at(-1));
    const privateDownload=req.method==="GET"&&(path.startsWith("/storage/v1/object/authenticated/")||path.startsWith("/storage/v1/object/salesgo-products/"));
    if(!newRpc&&path!=="/rest/v1/catalog_links"&&path!=="/rest/v1/account_profiles"&&!privateDownload)return original(req,res);
    res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Headers","*");res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
    if(req.method==="OPTIONS"){res.writeHead(204);return res.end();}
    let user=null;try{user=JSON.parse(Buffer.from(req.headers.authorization?.split(".")[1]||"","base64url").toString()).sub;}catch{}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString()||"{}");
    catalogRequests.push({path,user,secret:req.headers.apikey===secret});
    let data;
    try{
      if(path==="/rest/v1/account_profiles")data=[profiles.get(user)].filter(Boolean);
      else if(path==="/rest/v1/catalog_links"){
        const co=url.searchParams.get("company_id")?.slice(3),m=member(co,user);if(!m)throw Error("Company access denied");
        data=links.filter(l=>l.company_id===co&&(m.role==="admin"||l.created_by===user)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(0,51);
      }else if(path.endsWith("/search_catalog_share_products")){
        if(!member(body.target_company,user))throw Error("Company access denied");const term=body.search_text.toLowerCase();
        const rows=f.products.filter(p=>p.company_id===body.target_company&&!p.deleted_at&&`${p.serial} ${p.name} ${p.description||""}`.toLowerCase().includes(term));
        data={...shaped(page(rows,body.after_id?{id:body.after_id,created_at:body.after_created}:null)),total:rows.length,public_total:rows.filter(p=>p.catalog_public).length};
      }else if(path.endsWith("/set_catalog_visibility_batch")){
        if(member(body.target_company,user)?.role!=="admin")throw Error("Administrator required");const term=body.search_text.toLowerCase(),rows=f.products.filter(p=>p.company_id===body.target_company&&!p.deleted_at&&`${p.serial} ${p.name} ${p.description||""}`.toLowerCase().includes(term));if(rows.length!==body.expected_count)throw Error("Matching products changed");data=0;for(const p of rows)if(p.catalog_public!==body.visible){p.catalog_public=body.visible;p.revision++;data++;}
      }else if(path.endsWith("/set_product_catalog_visibility")){
        if(member(body.target_company,user)?.role!=="admin")throw Error("Administrator required");const p=f.products.find(p=>p.company_id===body.target_company&&p.id===body.target_product&&p.revision===body.expected_revision);if(!p)throw Error("Product changed");p.catalog_public=body.visible;p.revision++;data={id:p.id,catalog_public:p.catalog_public,revision:p.revision};
      }else if(path.endsWith("/create_catalog_link")){
        if(!member(body.target_company,user))throw Error("Company access denied");const profile=profiles.get(user);if(!profile?.whatsapp)throw Error("Save your name and work WhatsApp with country code first");
        const existing=links.find(l=>l.id===body.request_id);if(existing)data=existing;else{
          const available=f.products.filter(p=>p.company_id===body.target_company&&p.catalog_public&&!p.deleted_at);
          if(!available.length)throw Error("No public products");if(body.selected_ids?.some(id=>!available.find(p=>p.id===id)))throw Error("Some selected products are not public");
          data={id:body.request_id,company_id:body.target_company,created_by:user,token:body.link_token,label:body.link_label,scope:body.selected_ids===null?"all":"selected",product_ids:body.selected_ids||[],seller_name:profile.display_name,whatsapp:profile.whatsapp,created_at:now(),expires_at:new Date(Date.now()+7*86400000).toISOString(),revoked_at:null};links.push(data);
        }if(state.lostReply){state.lostReply=false;throw Error("Simulated lost reply");}
      }else if(path.endsWith("/revoke_catalog_link")){
        const l=links.find(l=>l.id===body.target_link&&l.company_id===body.target_company),m=member(body.target_company,user);if(!l||!m||(l.created_by!==user&&m.role!=="admin"))throw Error("Link unavailable");l.revoked_at=now();data=null;
      }else if(path.endsWith("/read_public_catalog")){
        const l=live(body.link_token);if(!l)throw Error("Catalog link unavailable");const term=body.search_text.toLowerCase(),rows=f.products.filter(p=>visible(l,p)&&`${p.serial} ${p.name} ${p.description||""}`.toLowerCase().includes(term));
        const result=shaped(page(rows,body.after_id?{id:body.after_id,created_at:body.after_created}:null));
        // Deliberately includes internal fields. The public HTTP DTO must remove them.
        const filtered=body.category_filter==null?rows:rows.filter(p=>(p.category||'').toLowerCase()===body.category_filter.toLowerCase()),categoryResult=shaped(page(filtered,body.after_id?{id:body.after_id,created_at:body.after_created}:null));
        data={...categoryResult,total:filtered.length,categories:[...new Set(f.products.filter(p=>visible(l,p)).map(p=>p.category||''))],company_name:f.companies.find(c=>c.id===l.company_id).name,seller_name:l.seller_name,whatsapp:l.whatsapp,expires_at:l.expires_at,items:categoryResult.items.map(p=>({...p,has_image:!!p.image_path}))};
      }else if(path.endsWith("/public_catalog_image")||path.endsWith("/public_catalog_inquiry")){
        const l=live(body.link_token),p=f.products.find(p=>p.id===body.target_product);if(!l||!p||!visible(l,p))throw Error("Catalog link unavailable");
        if(path.endsWith("/public_catalog_image")){if(!p.image_path)throw Error("Catalog image unavailable");data=p.image_path;}else data={whatsapp:l.whatsapp,serial:p.serial,name:p.name};
      }else{
        if(req.headers.apikey!==secret)throw Error("Private photo denied");res.writeHead(200,{"Content-Type":"image/png"});return res.end(f.png);
      }
      res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(data));
    }catch(err){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({message:err.message,code:/unavailable|denied/i.test(err.message)?"42501":"22023"}));}
  });
  return{...f,links,profiles,catalogState:state,secret,catalogRequests};
}
module.exports={createCatalogFixture};
