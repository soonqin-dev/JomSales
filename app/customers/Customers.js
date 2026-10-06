"use client";
import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import useCompanyScope from "../use-company-scope";
import { createClient } from "../../lib/supabase/client";
import { listCustomers,saveCustomer,setCustomerActive } from "../../lib/supabase/customers";
function List({context}) {
  const [rows,setRows]=useState([]),[search,setSearch]=useState(""),[inactive,setInactive]=useState(false),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [draft,setDraft]=useState(null),[previous,setPrevious]=useState(null),[dirty,setDirty]=useState(false);
  const sequence=useRef(0),working=useRef(false);
  async function load(){const version=++sequence.current;setLoading(true);setError("");try{const data=await listCustomers(createClient(),context.companyId,search,inactive,offset);if(version===sequence.current){setRows(data.items);setTotal(Number(data.total));}}catch(err){if(version===sequence.current)setError(err.message);}finally{if(version===sequence.current)setLoading(false);}}
  useEffect(()=>{const timer=setTimeout(load,250);return()=>{++sequence.current;clearTimeout(timer);};},[search,inactive,offset]);
  useEffect(()=>{const leave=e=>{if(dirty||busy){e.preventDefault();e.returnValue="";}};const link=e=>{if((dirty||busy)&&e.target.closest?.("a[href]")&&(busy||!window.confirm("客户资料尚未保存，确认离开？"))){e.preventDefault();e.stopPropagation();}};
    window.addEventListener("beforeunload",leave);document.addEventListener("click",link,true);return()=>{window.removeEventListener("beforeunload",leave);document.removeEventListener("click",link,true);};},[dirty,busy]);
  function edit(row=null){if(working.current||(dirty&&!window.confirm("放弃未保存的客户修改？")))return;setPrevious(row);setDraft(row||{id:crypto.randomUUID(),name:"",company:"",phone:"",email:"",address:""});setDirty(false);setError("");}
  async function run(task){if(working.current)return;working.current=true;setBusy(true);setError("");try{await task();await load();}catch(err){setError(err.message);}finally{working.current=false;setBusy(false);}}
  return <><Link href={`/cloud?company=${context.companyId}`}>← 产品目录</Link><h1>客户通讯录</h1><p>{context.name} · {context.role==="admin"?"可查看全公司客户；只能修改自己建立的客户。":"只有你建立的客户会显示。"}</p>
    {error&&<p role="alert" className="accountError">{error}</p>}{message&&<p role="status">{message}</p>}
    <button disabled={busy} onClick={()=>edit()}>新增客户</button>
    {draft&&<form className="accountCard" onSubmit={e=>{e.preventDefault();void run(async()=>{await saveCustomer(createClient(),context,draft,previous);setDraft(null);setPrevious(null);setDirty(false);setMessage("客户资料已保存，旧报价不会改变。");});}}><fieldset disabled={busy}>
      {[['name','客户姓名',120],['company','客户公司',120],['phone','客户电话',40],['email','客户邮箱',254],['address','客户地址',1000]].map(([key,label,max])=><label key={key}>{label}<input required={key==='name'} type={key==='email'?'email':key==='phone'?'tel':'text'} maxLength={max} value={draft[key]} onChange={e=>{setDraft({...draft,[key]:e.target.value});setDirty(true);}} /></label>)}
      <button>保存客户</button><button type="button" onClick={()=>{if(!dirty||window.confirm("放弃客户修改？")){setDraft(null);setDirty(false);}}}>取消</button>
    </fieldset></form>}
    <div className="accountCard"><label>查询客户<input maxLength={120} value={search} disabled={busy} onChange={e=>{setSearch(e.target.value);setOffset(0);}} /></label><label>显示范围<select value={inactive?'all':'active'} disabled={busy} onChange={e=>{setInactive(e.target.value==='all');setOffset(0);}}><option value="active">有效客户</option><option value="all">包含停用客户</option></select></label>
      {loading&&<p role="status">正在读取客户…</p>}{!loading&&!rows.length&&<p>没有符合条件的客户。</p>}
      {rows.map(row=><article className="teamRow" key={row.id}><div><strong>{row.name}</strong><p>{row.company} · {row.phone} · {row.email}</p><p>{row.address}</p><p>所属员工：{row.owner_name || row.owner_email || '姓名待补填'}{context.role==='admin'&&row.owner_email&&row.owner_name!==row.owner_email&&` · ${row.owner_email}`}</p><p>{row.active?'有效':'已停用'}{row.created_by===context.userId?' · 我建立的':' · 其他员工建立的（只读）'}</p></div>
        {row.created_by===context.userId&&<div className="cloudButtons"><button disabled={busy} onClick={()=>edit(row)}>编辑客户</button><button disabled={busy} onClick={()=>{if(window.confirm(`${row.active?'停用':'恢复'} ${row.name}？历史报价不受影响。`))void run(async()=>{await setCustomerActive(createClient(),context,row,!row.active);setMessage("客户状态已更新。");});}}>{row.active?'停用客户':'恢复客户'}</button></div>}
      </article>)}<div className="cloudButtons"><button disabled={busy||loading||!offset} onClick={()=>setOffset(value=>Math.max(0,value-50))}>上一页</button><span>共 {total} 位</span><button disabled={busy||loading||offset+50>=total} onClick={()=>setOffset(value=>value+50)}>下一页</button></div>
    </div></>;
}
export default function Customers(){const {context,error}=useCompanyScope();return <main className="page accountPage">{error&&<p role="alert">{error}</p>}{context?<List key={`${context.userId}:${context.companyId}:${context.role}`} context={context}/>:<p>正在确认公司权限… <Link href="/account">账号</Link></p>}</main>;}
