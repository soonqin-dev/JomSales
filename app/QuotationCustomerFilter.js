"use client";
import {useEffect,useRef,useState} from 'react';
import {createClient} from '../lib/supabase/client';
export default function QuotationCustomerFilter({companyId,creator=null,value,onChange,disabled}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[offset,setOffset]=useState(0),[rows,setRows]=useState([]),[more,setMore]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),sequence=useRef(0);
  useEffect(()=>{setOpen(false);setOffset(0);setRows([]);setQuery('');},[creator,companyId]);
  useEffect(()=>{if(!open)return;const version=++sequence.current;setRows([]);setLoading(true);setError('');const timer=setTimeout(async()=>{try{const r=await createClient().rpc('quotation_customer_options',{target_company:companyId,filter_creator:creator,option_search:query,page_offset:offset});if(r.error)throw r.error;if(version===sequence.current){setRows(r.data.items);setMore(r.data.has_more);}}catch(err){if(version===sequence.current)setError(err.message);}finally{if(version===sequence.current)setLoading(false);}},200);return()=>{clearTimeout(timer);++sequence.current;};},[open,query,offset,creator,companyId,retry]);
  return <div><button type="button" disabled={disabled} onClick={()=>setOpen(v=>!v)}>筛选报价顾客{value!==null?`：${value||'未填写客户'}`:'：全部'}</button>{value!==null&&<button type="button" disabled={disabled} onClick={()=>{onChange(null);setOpen(false);}}>清除顾客筛选</button>}
    {open&&<div className="accountCard"><label>查找报价顾客<input aria-label="查找报价顾客" maxLength={120} disabled={disabled} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);}}/></label>
      {loading&&<p role="status">正在读取顾客筛选…</p>}{error&&<p role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>重读顾客筛选</button></p>}
      {!loading&&!error&&!rows.length&&<p>没有符合的报价顾客。</p>}
      {rows.map(name=><p key={name}><button type="button" disabled={disabled||loading} onClick={()=>{onChange(name);setOpen(false);}}>筛选顾客：{name||'未填写客户'}</button></p>)}
      <div className="cloudButtons"><button type="button" disabled={disabled||loading||!offset} onClick={()=>setOffset(n=>Math.max(0,n-30))}>上一批顾客</button><button type="button" disabled={disabled||loading||!more} onClick={()=>setOffset(n=>n+30)}>下一批顾客</button></div>
    </div>}
  </div>;
}
