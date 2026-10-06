"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useCompanyScope from "../use-company-scope";
import { createClient } from "../../lib/supabase/client";
import { listQuotations, manageQuotation } from "../../lib/supabase/workspace";
import { quoteStatus,formatAmount } from "../quotation-utils";
import {recentQuotationRange} from '../../lib/quotation-filters';
import EmployeeFilter from '../EmployeeFilter';
import QuotationCustomerFilter from '../QuotationCustomerFilter';
import QuotationDateFilter from '../QuotationDateFilter';
function List({ context }) {
  const [rows, setRows] = useState([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [trash, setTrash] = useState(false), [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [busy, setBusy] = useState(false);
  const [events,setEvents]=useState({});
  const [page,setPage]=useState(0),[pageInfo,setPageInfo]=useState({has_more:false,cursor:null});
  const [creator,setCreator]=useState(null),[customer,setCustomer]=useState(null),[dateRange,setDateRange]=useState(()=>recentQuotationRange());
  const sequence = useRef(0), working = useRef(false),cursors=useRef([null]),cursor=useRef(null);
  async function load(afterOperation=false) {
    if(working.current&&!afterOperation)return;
    const version = ++sequence.current; setLoading(true); setError(""); setRows([]);setEvents({});
    try { const result = await listQuotations(createClient(), context.companyId, trash,{search,status,creator,customer,...dateRange,cursor:cursor.current}); if (version === sequence.current){setRows(result.items);setPageInfo(result);} }
    catch (err) { if (version === sequence.current) setError(`报价读取失败：${err.message}。请确认已执行最新报价 SQL。`); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => {const timer=setTimeout(()=>void load(),200);return()=>{clearTimeout(timer);++sequence.current;};}, [trash,search,status,page,creator,customer,dateRange]);
  function resetPage(){++sequence.current;cursor.current=null;cursors.current=[null];setPage(0);setRows([]);setEvents({});setLoading(true);}
  function navigate(next){if(working.current||loading||next<0)return;if(next>page)cursors.current[next]=pageInfo.cursor;cursor.current=cursors.current[next]||null;++sequence.current;setRows([]);setEvents({});setLoading(true);setPage(next);}
  async function act(row, action) {
    if (working.current) return;
    if (action === "trash" && !window.confirm(`报价 ${row.number} 将移入回收站，15天后永久删除，期间可以恢复。继续吗？`)) return;
    if ((action==="paid" || (row.status==="paid" && ['pending','success'].includes(action))) && !window.confirm(action==="paid" ? `确认 ${row.number} 已全额收款？这是人工记录，不会执行支付。` : `更正 ${row.number} 的 Paid 状态？更正会记录操作人和时间。`)) return;
    working.current = true; setBusy(true); setError("");
    const version = sequence.current;
    try {
      const next = await manageQuotation(createClient(), context.companyId, row, action);
      if (version !== sequence.current) return;
      await load(true);
    } catch (err) { if (version === sequence.current) setError(`操作未确认：${err.message}。请刷新列表核对后重试。`); }
    finally { working.current = false; setBusy(false); }
  }
  const visible = rows;
  return <>
    <Link href={`/cloud?company=${context.companyId}`}>← 公司产品目录</Link><h1>{trash ? "报价回收站" : "已保存报价"}</h1>
    <p>{context.name} · {context.role === "admin" ? "管理员可管理本公司全部报价，并查看所属员工。" : "仅显示你自己的报价。"}</p>
    <div className="cloudButtons">
      <Link href={`/cloud?company=${context.companyId}`}>新建报价</Link>
      <button disabled={loading || busy} onClick={()=>void load()}>刷新报价列表</button>
      <button disabled={busy} onClick={() => {resetPage();setTrash(value => !value);}}>{trash ? "返回已保存报价" : "回收站"}</button>
    </div>
    {trash && <p>删除后保留15天，可在到期前恢复。到期后不可恢复，后台每小时永久清理一次；已下载／分享的文件无法撤回。</p>}
    <div className="quotationHistoryFilters">
    <label>搜索报价<input value={search} maxLength={240} disabled={busy} onChange={e => {resetPage();setSearch(e.target.value);}} placeholder="报价编号、客户、员工姓名或邮箱" /></label>
    <label>报价状态<select aria-label="报价状态" value={status} disabled={busy} onChange={e => {resetPage();setStatus(e.target.value);}}>
      <option value="all">全部</option><option value="pending">Pending · 待确认</option><option value="success">Success · 已成交</option><option value="paid">Paid · 人工确认全额收款</option>
    </select></label>
    {context.role==='admin'&&<EmployeeFilter companyId={context.companyId} value={creator} disabled={busy} onChange={value=>{resetPage();setCreator(value);setCustomer(null);}}/>}
    <QuotationCustomerFilter key={creator||'own'} companyId={context.companyId} creator={creator} value={customer} disabled={busy} onChange={value=>{if(value===customer)return;resetPage();setCustomer(value);}}/>
    </div>
    <QuotationDateFilter range={dateRange} disabled={busy} onApply={range=>{resetPage();setDateRange(range);}}/>
    {loading && <p role="status">正在读取…</p>}{error && <p role="alert" className="accountError">{error}</p>}
    {!loading && !error && !visible.length && <p>{trash ? "回收站没有符合条件的报价。" : "没有符合条件的已保存报价。"}</p>}
    {visible.map(row => <article className="accountCard quotationHistoryRow" key={row.id}>
      <strong>{row.number}</strong><p>{row.customer_name || "未填写客户"} · {row.quote_date}</p>
      <p>所属员工：{row.creator_name || row.creator_email || row.created_by}{row.created_by === context.userId ? "（我）" : ""}</p>
      <p>状态：{quoteStatus(row.status)} · {formatAmount(row.total_amount)}</p>
      <div className="cloudButtons">
        {trash ? <>
          <p>可恢复至：{new Date(new Date(row.deleted_at).getTime() + 15 * 86400000).toLocaleString()}</p>
          <button disabled={busy || loading} onClick={() => act(row, "restore")}>恢复报价</button>
        </> : <>
          {busy ? <span>正在更新…</span> : <Link href={`/cloud?company=${context.companyId}&quote=${row.id}`}>选择报价</Link>}
          {!busy&&<Link href={`/cloud?company=${context.companyId}&duplicate=${row.id}`}>复制为新报价</Link>}
          <button disabled={busy || loading} onClick={() => act(row, row.status !== "pending" ? "pending" : "success")}>
            {row.status !== "pending" ? "标记为 Pending" : "标记为 Success（客户已成交）"}
          </button>
          {row.status!=="paid"&&<button disabled={busy||loading} onClick={()=>act(row,"paid")}>标记为 Paid（已全额收款）</button>}
          {row.status==="paid"&&<button disabled={busy||loading} onClick={()=>act(row,"success")}>更正为 Success</button>}
          <button className="deleteButton" disabled={busy || loading} onClick={() => act(row, "trash")}>删除报价</button>
        </>}
      </div>
      <button disabled={busy||loading} onClick={async()=>{try{const result=await createClient().from("quotation_events").select("id,action,actor,details,created_at").eq("quote_id",row.id).eq("company_id",context.companyId).order("created_at",{ascending:false}).limit(100);if(result.error)throw result.error;setEvents(prev=>({...prev,[row.id]:result.data}));}catch(err){setError(err.message);}}}>查看最近操作记录</button>
      {events[row.id]&&<ul>{events[row.id].map(event=><li key={event.id}>{new Date(event.created_at).toLocaleString()} · {({created:"创建",edited:"修改",status:"状态更新",trashed:"移入回收箱",restored:"恢复"})[event.action]||event.action} · {event.details.actor_name || event.details.actor_email || event.actor || "系统"} · {quoteStatus(event.details.status)}</li>)}</ul>}
    </article>)}
    <div className="cloudButtons"><button disabled={busy||loading||!page} onClick={()=>navigate(page-1)}>上一页报价</button><span>第 {page+1} 页 · 每页最多 30 张报价</span><button disabled={busy||loading||!pageInfo.has_more} onClick={()=>navigate(page+1)}>下一页报价</button></div>
  </>;
}
export default function History() {
  const { context, error } = useCompanyScope();
  return <main className="page accountPage">{error && <p role="alert">{error}</p>}{context ? <List key={`${context.userId}:${context.companyId}:${context.role}`} context={context} /> : <p>正在确认公司访问权限… <Link href="/account">公司账号</Link></p>}</main>;
}
