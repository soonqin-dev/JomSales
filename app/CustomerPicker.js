"use client";
import { useEffect,useRef,useState } from "react";
import { createClient } from "../lib/supabase/client";
import { listCustomers } from "../lib/supabase/customers";
export default function CustomerPicker({context,disabled,onSelect}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState(""),[rows,setRows]=useState([]),[error,setError]=useState(""),[loading,setLoading]=useState(false),[offset,setOffset]=useState(0),[total,setTotal]=useState(0);
  const sequence=useRef(0);
  useEffect(()=>{
    if(!open)return;
    const version=++sequence.current;setLoading(true);setError("");setRows([]);
    const timer=setTimeout(async()=>{try{const data=await listCustomers(createClient(),context.companyId,search,false,offset);if(version===sequence.current){setRows(data.items);setTotal(Number(data.total));}}
      catch(err){if(version===sequence.current)setError(err.message);}finally{if(version===sequence.current)setLoading(false);}},250);
    return()=>{++sequence.current;clearTimeout(timer);};
  },[open,search,offset,context.companyId]);
  return <div><button type="button" disabled={disabled} onClick={()=>setOpen(value=>!value)}>{open?"收起客户选择":"选择已保存客户"}</button>
    {open && <div className="accountCard"><label>查询客户<input aria-label="选择客户查询" value={search} maxLength={120} disabled={disabled} onChange={e=>{setSearch(e.target.value);setOffset(0);}} /></label>
      {loading&&<p role="status">正在查询客户…</p>}{error&&<p role="alert">{error}</p>}
      {!loading&&!error&&!rows.length&&<p>没有客户，请手动填写或到客户通讯录新增。</p>}
      {rows.map(row=><div className="teamRow" key={row.id}><div><strong>{row.name}</strong><p>{row.company} · {row.phone}</p>{context.role==='admin'&&<p>所属员工：{row.owner_name || row.owner_email || '姓名待补填'}</p>}</div><button type="button" disabled={disabled} onClick={()=>{onSelect(row);setOpen(false);}}>选用 {row.name}</button></div>)}
      <div className="cloudButtons"><button type="button" disabled={disabled||loading||!offset} onClick={()=>setOffset(value=>Math.max(0,value-50))}>上一批客户</button><button type="button" disabled={disabled||loading||offset+50>=total} onClick={()=>setOffset(value=>value+50)}>下一批客户</button></div>
    </div>}
  </div>;
}
