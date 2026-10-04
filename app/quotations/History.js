"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useCompanyScope from "../use-company-scope";
import { createClient } from "../../lib/supabase/client";
import { listQuotations, manageQuotation } from "../../lib/supabase/workspace";
import { EmptyState, NavLink, PageHeader, Panel } from "../ui";
function List({ context }) {
  const [rows, setRows] = useState([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [trash, setTrash] = useState(false), [search, setSearch] = useState(""), [status, setStatus] = useState("all"), [busy, setBusy] = useState(false);
  const sequence = useRef(0), working = useRef(false);
  async function load() {
    const version = ++sequence.current; setLoading(true); setError(""); setRows([]);
    try { const result = await listQuotations(createClient(), context.companyId, trash); if (version === sequence.current) setRows(result); }
    catch (err) { if (version === sequence.current) setError(`报价读取失败：${err.message}。请确认已执行最新报价 SQL。`); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { ++sequence.current; }; }, [trash]);
  async function act(row, action) {
    if (working.current) return;
    if (action === "trash" && !window.confirm(`报价 ${row.number} 将移入回收站，15天后永久删除，期间可以恢复。继续吗？`)) return;
    working.current = true; setBusy(true); setError("");
    const version = sequence.current;
    try {
      const next = await manageQuotation(createClient(), context.companyId, row, action);
      if (version !== sequence.current) return;
      setRows(prev => action === "trash" || action === "restore" ? prev.filter(q => q.id !== row.id) : prev.map(q => q.id === row.id ? next : q));
    } catch (err) { if (version === sequence.current) setError(`操作未确认：${err.message}。请刷新列表核对后重试。`); }
    finally { working.current = false; setBusy(false); }
  }
  const term = search.trim().toLowerCase();
  const visible = rows.filter(row => (status === "all" || row.status === status) &&
    (!term || [row.number, row.customer_name, row.creator_email].some(value => (value || "").toLowerCase().includes(term))));
  return <>
    <PageHeader title={trash ? "报价回收站" : "已保存报价"} subtitle={context.name} />
    <NavLink href={`/cloud?company=${context.companyId}`}>← 公司产品目录</NavLink>
    <p>{context.name} · {context.role === "admin" ? "管理员可管理本公司全部报价，并查看所属员工。" : "仅显示你自己的报价。"}</p>
    <div className="cloudButtons">
      <Link href={`/cloud?company=${context.companyId}`}>新建报价</Link>
      <button disabled={loading || busy} onClick={load}>刷新报价列表</button>
      <button disabled={busy} onClick={() => setTrash(value => !value)}>{trash ? "返回已保存报价" : "回收站"}</button>
    </div>
    {trash && <p>删除后保留15天，可在到期前恢复。到期后不可恢复，后台每小时永久清理一次；已下载／分享的文件无法撤回。</p>}
    <div className="quotationHistoryFilters">
    <label>搜索报价<input value={search} onChange={e => setSearch(e.target.value)} placeholder="报价编号、客户或员工邮箱" /></label>
    <label>报价状态<select value={status} onChange={e => setStatus(e.target.value)}>
      <option value="all">全部</option><option value="pending">Pending · 待确认</option><option value="success">Success · 已成交</option>
    </select></label>
    </div>
    {loading && <p role="status">正在读取…</p>}{error && <p role="alert" className="accountError">{error}</p>}
    {!loading && !error && !visible.length && <EmptyState title={trash ? "回收站没有符合条件的报价。" : "没有符合条件的已保存报价。"}>可调整筛选条件，或返回目录开始新报价。</EmptyState>}
    {visible.map(row => <Panel className="accountCard quotationHistoryRow" key={row.id}>
      <div className="historyHeading"><div><strong>{row.number}</strong><p>{row.customer_name || "未填写客户"} · {row.quote_date}</p></div>
        <span className={`statusBadge statusBadge-${row.status}`}>{row.status === "success" ? "Success" : "Pending"}</span>
      </div>
      <p>所属员工：{row.creator_email || row.created_by}{row.created_by === context.userId ? "（我）" : ""}</p>
      <p>状态：{row.status === "success" ? "Success · 已成交（不代表已收款）" : "Pending · 待客户确认"}</p>
      <div className="cloudButtons">
        {trash ? <>
          <p>可恢复至：{new Date(new Date(row.deleted_at).getTime() + 15 * 86400000).toLocaleString()}</p>
          <button disabled={busy || loading} onClick={() => act(row, "restore")}>恢复报价</button>
        </> : <>
          {busy ? <span>正在更新…</span> : <Link href={`/cloud?company=${context.companyId}&quote=${row.id}`}>选择报价</Link>}
          <button disabled={busy || loading} onClick={() => act(row, row.status === "success" ? "pending" : "success")}>
            {row.status === "success" ? "标记为 Pending" : "标记为 Success（客户已成交）"}
          </button>
          <button className="deleteButton" disabled={busy || loading} onClick={() => act(row, "trash")}>删除报价</button>
        </>}
      </div>
    </Panel>)}
  </>;
}
export default function History() {
  const { context, error } = useCompanyScope();
  return <main className="page accountPage">{error && <p role="alert">{error}</p>}{context ? <List key={`${context.userId}:${context.companyId}:${context.role}`} context={context} /> : <p>正在确认公司访问权限… <Link href="/account">公司账号</Link></p>}</main>;
}
