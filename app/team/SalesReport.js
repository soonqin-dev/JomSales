"use client";
import { useEffect,useRef,useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { formatAmount } from "../quotation-utils";
function monthRange(){const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kuala_Lumpur",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());return [date.slice(0,8)+"01",date];}
export default function SalesReport({companyId}){
  const [from,setFrom]=useState(()=>monthRange()[0]),[to,setTo]=useState(()=>monthRange()[1]),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const sequence=useRef(0);
  async function load(){const version=++sequence.current;setBusy(true);setError("");setData(null);try{const result=await createClient().rpc("company_sales_report",{target_company:companyId,start_date:from,end_date:to});if(result.error)throw result.error;if(version===sequence.current)setData(result.data);}catch(err){if(version===sequence.current)setError(err.message);}finally{if(version===sequence.current)setBusy(false);}}
  useEffect(()=>{void load();return()=>{++sequence.current;};},[companyId]);
  const max=Math.max(0,...(data?.rows||[]).map(row=>Number(row.confirmed_amount)));
  return <section className="accountCard"><h2>员工成交排行</h2><form onSubmit={e=>{e.preventDefault();void load();}}><label>开始日期<input type="date" required value={from} onChange={e=>{++sequence.current;setFrom(e.target.value);setData(null);setBusy(false);}}/></label><label>结束日期<input type="date" required min={from} value={to} onChange={e=>{++sequence.current;setTo(e.target.value);setData(null);setBusy(false);}}/></label><button disabled={busy}>查询业绩</button></form>
    <p>马来西亚时间。报价数按首次保存时间，成交及 Paid 按标记时间。成交包含 Success＋Paid，不重复计数；金额按当前报价计算。Paid 不是支付对账。货物量来自成交报价，服务及未记录类型的旧项目不计入。</p>
    {busy&&<p role="status">正在读取业绩…</p>}{error&&<p role="alert">{error}</p>}
    {data?.legacy_undated>0&&<p>有 {data.legacy_undated} 张旧成交报价缺少成交时间，不计入日期筛选的成交排行。</p>}
    {(data?.rows||[]).map((row,index)=><article className="teamRow" key={row.user_id}><div><strong>{index+1}. {row.name}</strong><p>{row.removed_at?'已移除员工':row.active?'有效成员':'已停用成员'} · {row.email}</p>
      <p>报价数 {row.quote_count} · 成交单数 {row.confirmed_count}</p><p>成交报价金额：{formatAmount(row.confirmed_amount)} · Paid 报价金额：{formatAmount(row.paid_amount)}</p>
      <p>货物量：{row.goods?.length?row.goods.map(item=>`${item.quantity} ${item.unit}`).join("、"):"0"}</p>
      <div className="salesBar" role="img" aria-label={`${row.name} 成交额 ${formatAmount(row.confirmed_amount)}`}><div style={{width:`${max?Math.min(100,Number(row.confirmed_amount)/max*100):0}%`}}/></div>
    </div></article>)}
  </section>;
}
