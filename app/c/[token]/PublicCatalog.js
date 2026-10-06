"use client";
import { useEffect, useRef, useState } from "react";

export default function PublicCatalog({ token }) {
  const [data,setData]=useState(null),[query,setQuery]=useState(""),[page,setPage]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState(""),[selected,setSelected]=useState(null);
  const [imageErrors,setImageErrors]=useState({});
  const sequence=useRef(0),abort=useRef(null),cursors=useRef([null]),current=useRef({query:"",page:0}),loadRef=useRef(null);
  const api=`/api/catalog/${token}`;
  async function load() {
    const version=++sequence.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;
    setBusy(true);setError("");setData(null);setSelected(null);setImageErrors({});
    const state=current.current,params=new URLSearchParams({q:state.query}),cursor=cursors.current[state.page];
    if(cursor){params.set("after_created",cursor.created_at);params.set("after_id",cursor.id);}
    try {const response=await fetch(`${api}?${params}`,{cache:"no-store",signal:controller.signal}),result=await response.json();
      if(version!==sequence.current)return;if(!response.ok)throw new Error(result.error || "目录读取失败，请重试。");
      if(Date.parse(result.expires_at)<=Date.now())throw new Error("此目录链接已到期，请索取新链接。");setData(result);
    }catch(err){if(version===sequence.current&&err.name!=="AbortError")setError(err.message || "网络暂时不可用，请重试。");}
    finally{if(version===sequence.current)setBusy(false);}
  }
  loadRef.current=load;
  useEffect(()=>{const timer=setTimeout(()=>void loadRef.current(),200);return()=>{clearTimeout(timer);++sequence.current;abort.current?.abort();};},[query,page]);
  useEffect(()=>{const refresh=()=>void loadRef.current(),timer=setInterval(refresh,60000);window.addEventListener("focus",refresh);return()=>{clearInterval(timer);window.removeEventListener("focus",refresh);};},[]);
  useEffect(()=>{if(!data)return;const delay=Math.max(0,Math.min(2147483647,Date.parse(data.expires_at)-Date.now()));const timer=setTimeout(()=>{++sequence.current;abort.current?.abort();setData(null);setSelected(null);setBusy(false);setError("此目录链接已到期，请索取新链接。");},delay);return()=>clearTimeout(timer);},[data]);
  function search(value){++sequence.current;abort.current?.abort();current.current={query:value,page:0};cursors.current=[null];setData(null);setSelected(null);setBusy(true);setQuery(value);setPage(0);}
  function navigate(next){if(busy||!data||next<0)return;if(next>page)cursors.current[next]=data.cursor;current.current={query,page:next};setData(null);setSelected(null);setBusy(true);setPage(next);}
  const inquiry=p=><a href={`${api}/inquire/${p.id}`} target="_blank" rel="noopener noreferrer">WhatsApp 询价</a>;
  function imageFailed(e,id){e.currentTarget.hidden=true;setImageErrors(prev=>({...prev,[id]:true}));}
  return <main className="page accountPage publicCatalog"><h1>{data?.company_name || "产品目录"}</h1>
    {data&&<p>联系人：{data.seller_name} · {data.whatsapp}</p>}
    <label>搜索产品<input value={query} maxLength={240} placeholder="产品编号、名称、分类、标签" onChange={e=>search(e.target.value)}/></label>
    <button disabled={busy} onClick={()=>void load()}>刷新目录</button>
    {busy&&<p role="status">正在读取目录…</p>}{error&&<p role="alert">{error}</p>}
    {data&&<><p>{data.total} 项产品 · 有效至 {new Date(data.expires_at).toLocaleString()}</p>
      {!data.items.length&&<p>没有符合条件的产品。</p>}
      {data.items.map(p=><article className="accountCard" key={p.id}>
        {p.has_image&&<img className="catalogPublicThumb" loading="lazy" decoding="async" src={`${api}/image/${p.id}`} alt={p.name} onError={e=>imageFailed(e,p.id)}/>}
        {imageErrors[p.id]&&<p>图片暂时无法读取，可以刷新目录重试。</p>}
        <h2>{p.name}</h2><p>产品编号：{p.serial}</p><p>{p.category}{p.category&&" · "}{p.unit || "件"}{p.is_service&&" · 服务"}</p>
        {!!p.tags?.length&&<p>{p.tags.join(" · ")}</p>}
        <button onClick={()=>setSelected(selected?.id===p.id?null:p)}>{selected?.id===p.id?"收起详情":"查看详情"} · {p.serial}</button> {inquiry(p)}
        {selected?.id===p.id&&<div>{p.description&&<p className="preserveLines">{p.description}</p>}{p.has_image&&<img className="preview" src={`${api}/image/${p.id}?full=1`} alt={`${p.name} 详情照片`} onError={e=>imageFailed(e,p.id)}/>}</div>}
      </article>)}
      <div className="cloudButtons"><button disabled={busy||page===0} onClick={()=>navigate(page-1)}>上一页</button><span>第 {page+1} 页 · 每页最多 50 项</span><button disabled={busy||!data.has_more} onClick={()=>navigate(page+1)}>下一页</button></div>
    </>}
    <p>JomSales</p>
  </main>;
}
