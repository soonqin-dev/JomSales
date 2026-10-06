"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useCompanyScope from "../use-company-scope";
import { createClient } from "../../lib/supabase/client";
import { newCatalogLinkRequest,createCatalogLink,listCatalogLinks,catalogLinkError } from "../../lib/supabase/catalog-links";

function ShareWorkspace({context}) {
  const [products,setProducts]=useState({items:[],has_more:false}),[query,setQuery]=useState(""),[productPage,setProductPage]=useState(0),[picked,setPicked]=useState({});
  const [links,setLinks]=useState({items:[],hasMore:false}),[linkPage,setLinkPage]=useState(0),[scope,setScope]=useState("all"),[label,setLabel]=useState("");
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(""),[message,setMessage]=useState(""),[profile,setProfile]=useState(null),[created,setCreated]=useState(null);
  const working=useRef(false),productSequence=useRef(0),linkSequence=useRef(0),productCursors=useRef([null]),linkCursors=useRef([null]),pending=useRef(null);
  const count=Object.keys(picked).length,dirty=!!label.trim()||count>0;
  const url=row=>`${window.location.origin}/c/${row.token}`;
  async function readProducts(){const version=++productSequence.current;setLoading(true);setError("");const cursor=productCursors.current[productPage];try{
    const result=await createClient().rpc("search_catalog_share_products",{target_company:context.companyId,search_text:query,after_created:cursor?.created_at || null,after_id:cursor?.id || null});
    if(result.error)throw result.error;if(version===productSequence.current)setProducts(result.data);
  }catch(err){if(version===productSequence.current){setProducts({items:[],has_more:false});setError(catalogLinkError(err.message));}}finally{if(version===productSequence.current)setLoading(false);}}
  async function readLinks(){const version=++linkSequence.current;try{const result=await listCatalogLinks(createClient(),context.companyId,linkCursors.current[linkPage]);if(version===linkSequence.current){setLinks(result);setCreated(prev=>prev?result.items.find(row=>row.id===prev.id)||prev:null);}}catch(err){if(version===linkSequence.current)setError(err.message);}}
  useEffect(()=>{const timer=setTimeout(()=>void readProducts(),200);return()=>{clearTimeout(timer);++productSequence.current;};},[query,productPage]);
  useEffect(()=>{void readLinks();return()=>{++linkSequence.current;};},[linkPage]);
  useEffect(()=>{const refresh=()=>{if(!working.current)void readLinks();},timer=setInterval(refresh,60000);window.addEventListener("focus",refresh);return()=>{clearInterval(timer);window.removeEventListener("focus",refresh);};},[linkPage]);
  useEffect(()=>{let active=true;createClient().from("account_profiles").select("display_name,whatsapp").eq("user_id",context.userId).maybeSingle().then(result=>{if(active){if(result.error)setError(result.error.message);else setProfile(result.data);}});return()=>{active=false;};},[]);
  useEffect(()=>{const leave=e=>{if(dirty||busy){e.preventDefault();e.returnValue="";}};const link=e=>{const a=e.target.closest?.("a[href]");if(a&&(dirty||busy)&&!a.hasAttribute("data-share-link")&&(busy||!window.confirm("尚未生成分享链接，确认放弃当前选择？"))){e.preventDefault();e.stopPropagation();}};window.addEventListener("beforeunload",leave);document.addEventListener("click",link,true);return()=>{window.removeEventListener("beforeunload",leave);document.removeEventListener("click",link,true);};},[dirty,busy]);
  async function run(action){if(working.current)return;working.current=true;setBusy(true);setError("");setMessage("");try{await action();}catch(err){setError(catalogLinkError(err.message));}finally{working.current=false;setBusy(false);}}
  async function submit(e){e.preventDefault();await run(async()=>{
    const ids=scope==="selected"?Object.keys(picked).sort():null,fingerprint=JSON.stringify([label.trim(),ids]);
    if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,request:newCatalogLinkRequest(context.companyId,label,ids)};
    const row=await createCatalogLink(createClient(),pending.current.request);setCreated(row);setLabel("");setPicked({});pending.current=null;setMessage("分享链接已生成，有效期固定 7 天。");
    linkCursors.current=[null];if(linkPage===0)await readLinks();else setLinkPage(0);
  });}
  async function copy(row){try{await navigator.clipboard.writeText(url(row));setMessage("链接已复制，可贴到 WhatsApp。");}catch{setMessage("未能自动复制，请长按／选中下方链接复制。");}}
  async function share(row){if(!navigator.share){await copy(row);return;}try{await navigator.share({title:`${context.name} · 产品目录`,url:url(row)});}catch(err){if(err.name!=="AbortError")setMessage("分享未完成，可以复制链接发送。");}}
  async function visibility(p){await run(async()=>{const result=await createClient().rpc("set_product_catalog_visibility",{target_company:context.companyId,target_product:p.id,expected_revision:p.revision,visible:!p.catalog_public});if(result.error)throw result.error;setProducts(prev=>({...prev,public_total:(prev.public_total||0)+(p.catalog_public?-1:1),items:prev.items.map(item=>item.id===p.id?{...item,...result.data}:item)}));if(p.catalog_public)setPicked(prev=>{const next={...prev};delete next[p.id];return next;});setMessage(p.catalog_public?"已停止公开该产品。":"已允许公开该产品，请确认照片、名称、标签和说明中没有敏感信息或价格。");});}
  async function bulkVisibility(visible){if(!window.confirm(`${visible?"允许公开":"停止公开"}当前搜索匹配的 ${products.total} 项产品（不是仅当前页）？${visible?"请先确认照片、名称、标签和说明中没有价格或内部信息。":"现有链接中这些产品将不可查看。"}`))return;await run(async()=>{const result=await createClient().rpc("set_catalog_visibility_batch",{target_company:context.companyId,search_text:query,expected_count:products.total,visible});if(result.error)throw result.error;if(!visible)setPicked({});await readProducts();setMessage(`批量设置完成，共修改 ${result.data} 项产品。`);});}
  const active=row=>!row.revoked_at&&Date.parse(row.expires_at)>Date.now();
  function pick(p,checked){setPicked(prev=>{const next={...prev};if(checked){if(Object.keys(next).length>=1000){setError("最多选择 1000 项产品。");return prev;}next[p.id]={serial:p.serial,name:p.name};}else delete next[p.id];return next;});}
  function goProduct(next){if(loading||busy||next<0)return;if(next>productPage)productCursors.current[next]=products.cursor;setProducts({items:[],has_more:false});setLoading(true);setProductPage(next);}
  function goLink(next){if(busy||next<0)return;if(next>linkPage)linkCursors.current[next]=links.cursor;setLinks({items:[],hasMore:false});setLinkPage(next);}
  return <><Link href={`/cloud?company=${context.companyId}`}>← 公司产品目录</Link><h1>顾客目录分享</h1>
    <p>{context.name} · {context.role==="admin"?"可设置产品公开权限、查看并撤销全公司链接。":"可创建和撤销自己的链接。"}</p>
    <p>不展示价格。链接固定 7 天；撤销、员工停用／移除或公司停用后失效。已下载的内容无法撤回。</p>
    <p>分享联系人：{profile?.display_name || "未设置姓名"} · {profile?.whatsapp || "未设置 WhatsApp"} · <Link href="/settings">个人设置</Link></p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <form onSubmit={submit}><fieldset disabled={busy}>
      <label>分享范围<select aria-label="分享范围" value={scope} onChange={e=>setScope(e.target.value)}><option value="all">公司全部允许公开的产品</option><option value="selected">只分享我挑选的产品</option></select></label>
      <label>链接名称（可选，仅内部可见）<input maxLength={120} value={label} onChange={e=>setLabel(e.target.value)}/></label>
      {scope==="selected"&&<p>已选 {count} 项 · 最多 1000 项 · 跨搜索和翻页保留选择</p>}
      <button disabled={!profile?.display_name || !profile?.whatsapp || (scope==="selected"&&!count)}>生成 7 天链接</button>
    </fieldset></form>
    {created&&<div className="accountCard"><strong>刚生成的链接</strong><p>有效至 {new Date(created.expires_at).toLocaleString()}</p><a className="catalogLinkUrl" data-share-link href={`/c/${created.token}`} target="_blank" rel="noopener noreferrer">{url(created)}</a><div className="cloudButtons"><button disabled={busy||!active(created)} onClick={()=>void copy(created)}>复制刚生成的链接</button><button disabled={busy||!active(created)} onClick={()=>void share(created)}>分享刚生成的链接</button></div></div>}
    <details open={scope==="selected"||context.role==="admin"}><summary>{context.role==="admin"?"产品公开设置与选择":"挑选产品"}</summary>
      <label>搜索分享产品<input maxLength={240} value={query} disabled={busy} onChange={e=>{++productSequence.current;productCursors.current=[null];setProducts({items:[],has_more:false});setLoading(true);setProductPage(0);setQuery(e.target.value);}}/></label>
      <button disabled={busy||loading} onClick={()=>void readProducts()}>刷新产品</button>
      {context.role==="admin"&&<details><summary>批量公开设置</summary><p>当前搜索匹配 {products.total || 0} 项，其中 {products.public_total || 0} 项已公开。操作跨越全部搜索结果，不限本页；每次最多 10,000 项。</p><div className="cloudButtons"><button disabled={busy||loading||!products.total||products.total>10000} onClick={()=>void bulkVisibility(true)}>允许公开全部搜索结果</button><button disabled={busy||loading||!products.total||products.total>10000} onClick={()=>void bulkVisibility(false)}>停止公开全部搜索结果</button></div></details>}
      {loading&&<p role="status">正在读取产品…</p>}{!loading&&!products.items.length&&<p>没有符合条件的产品。</p>}
      {products.items.map(p=><article className="accountCard" key={p.id}><strong>{p.serial} · {p.name}</strong><p>{p.catalog_public?"允许公开":"不公开"}</p>
        {context.role==="admin"&&<button disabled={busy||loading} onClick={()=>void visibility(p)}>{p.catalog_public?"停止公开":"允许公开"} · {p.serial}</button>}
        {scope==="selected"&&<label><input type="checkbox" checked={!!picked[p.id]} disabled={busy||!p.catalog_public} onChange={e=>pick(p,e.target.checked)}/>选择 {p.serial}</label>}
      </article>)}
      <div className="cloudButtons"><button disabled={busy||loading||!productPage} onClick={()=>goProduct(productPage-1)}>上一页产品</button><span>第 {productPage+1} 页 · 每页最多 30 项</span><button disabled={busy||loading||!products.has_more} onClick={()=>goProduct(productPage+1)}>下一页产品</button></div>
    </details>
    {scope==="selected"&&count>0&&<details><summary>检查已选产品（{count}）</summary>{Object.entries(picked).map(([id,p])=><p key={id}>{p.serial} · {p.name} <button disabled={busy} onClick={()=>pick({id},false)}>移除 {p.serial}</button></p>)}<button disabled={busy} onClick={()=>{if(window.confirm("清空已选产品？"))setPicked({});}}>清空选择</button></details>}
    <h2>已生成的链接</h2><button disabled={busy} onClick={()=>void readLinks()}>刷新链接</button>
    {!links.items.length&&<p>暂无链接。</p>}
    {links.items.map(row=><article className="accountCard" key={row.id}><strong>{row.label || "未命名链接"}</strong><p>分享员工：{row.seller_name} · {row.whatsapp}</p><p>{row.scope==="all"?"全部允许公开产品":`挑选 ${row.product_ids.length} 项`} · 有效至 {new Date(row.expires_at).toLocaleString()} · {row.revoked_at?"已撤销":active(row)?"有效":"已到期"}</p>
      {active(row)&&<><a className="catalogLinkUrl" data-share-link href={`/c/${row.token}`} target="_blank" rel="noopener noreferrer">{url(row)}</a><div className="cloudButtons"><button disabled={busy} onClick={()=>void copy(row)}>复制链接</button><button disabled={busy} onClick={()=>void share(row)}>分享链接</button><button disabled={busy} onClick={()=>{if(window.confirm("撤销后此链接永久失效，继续吗？"))void run(async()=>{const result=await createClient().rpc("revoke_catalog_link",{target_company:context.companyId,target_link:row.id});if(result.error)throw result.error;setLinks(prev=>({...prev,items:prev.items.map(item=>item.id===row.id?{...item,revoked_at:new Date().toISOString()}:item)}));if(created?.id===row.id)setCreated(null);setMessage("链接已撤销。");});}}>撤销链接</button></div></>}
    </article>)}
    <div className="cloudButtons"><button disabled={busy||!linkPage} onClick={()=>goLink(linkPage-1)}>上一页链接</button><span>第 {linkPage+1} 页</span><button disabled={busy||!links.hasMore} onClick={()=>goLink(linkPage+1)}>下一页链接</button></div>
  </>;
}
export default function CatalogShare(){const {context,error}=useCompanyScope();return <main className="page accountPage">{error&&<p role="alert">{error}</p>}{context?<ShareWorkspace key={`${context.companyId}:${context.userId}:${context.role}`} context={context}/>:<p>正在确认公司权限…</p>}</main>;}
