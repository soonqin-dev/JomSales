"use client";
import {useEffect,useRef,useState} from 'react';
import {createClient} from '../lib/supabase/client';
export default function EmployeeFilter({companyId,value,onChange,disabled,label='筛选员工'}){
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),sequence=useRef(0);
  useEffect(()=>{const version=++sequence.current;setRows([]);setLoading(true);setError('');createClient().rpc('get_company_roster',{target_company:companyId}).then(r=>{if(version!==sequence.current)return;if(r.error)setError(r.error.message);else setRows(r.data||[]);setLoading(false);}).catch(err=>{if(version===sequence.current){setError(err.message);setLoading(false);}});return()=>{++sequence.current;};},[companyId,retry]);
  return <div><label>{label}<select aria-label={label} value={value||''} disabled={disabled||loading||!!error} onChange={e=>onChange(e.target.value||null)}><option value="">全部员工（含管理员）</option>{rows.map(r=><option value={r.user_id} key={r.user_id}>{r.display_name||r.email}{r.display_name&&` · ${r.email}`}{r.removed_at?'（已移除）':!r.active?'（已停用）':''}</option>)}{value&&!rows.some(r=>r.user_id===value)&&<option value={value}>已选历史员工</option>}</select></label>{error&&<p role="alert">员工筛选读取失败：{error} <button type="button" disabled={disabled} onClick={()=>setRetry(n=>n+1)}>重读员工筛选</button></p>}</div>;
}
