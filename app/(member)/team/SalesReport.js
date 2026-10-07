"use client";
// RPT｜销售概览 — docs/pages-spec.md §6. Report rules are defined by company_sales_report.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { formatAmount } from "../../quotation-utils";
import { useMember } from "../../member-context";
import { EmptyState, InlineError, SkeletonList, TopBar } from "../../ui";

function monthRange() {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return [date.slice(0, 8) + "01", date];
}

export default function SalesReport() {
  const member = useMember();
  const [from, setFrom] = useState(() => monthRange()[0]), [to, setTo] = useState(() => monthRange()[1]);
  const [data, setData] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0);

  async function load() {
    if (to < from) { setError("结束日期不能早于开始日期。"); return; }
    const version = ++sequence.current;
    setBusy(true); setError(""); setData(null);
    try {
      const result = await createClient().rpc("company_sales_report", { target_company: member.companyId, start_date: from, end_date: to });
      if (result.error) throw result.error;
      if (version === sequence.current) setData(result.data);
    } catch (err) { if (version === sequence.current) setError(`读取失败：${err.message}`); }
    finally { if (version === sequence.current) setBusy(false); }
  }
  useEffect(() => { if (member.role === "admin") void load(); return () => { ++sequence.current; }; }, []);

  if (member.role !== "admin") return <main className="app-main"><TopBar title="销售概览" back="/me" />
    <EmptyState icon="lock" title="这个页面仅供公司管理员使用" action={<Link href="/cloud" className="btn btn-secondary btn-sm">回到产品目录</Link>} /></main>;

  const rows = data?.rows || [];
  const max = Math.max(0, ...rows.map(row => Number(row.confirmed_amount)));
  return (
    <main className="app-main">
      <TopBar title="销售概览" subtitle={member.name} back="/admin" />
      <div className="stack">
        <form className="card stack-sm" onSubmit={e => { e.preventDefault(); void load(); }}>
          <div className="fields-2">
            <label className="field"><span className="field-label">开始日期</span><input className="input" type="date" required value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label className="field"><span className="field-label">结束日期</span><input className="input" type="date" required min={from} value={to} onChange={e => setTo(e.target.value)} /></label>
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "查询中…" : "查询"}</button>
        </form>
        <InlineError onRetry={error ? () => void load() : undefined}>{error}</InlineError>
        {data?.legacy_undated > 0 && <div className="notice-box">有 {data.legacy_undated} 张旧成交报价缺少成交时间，不计入日期筛选的排行。</div>}
        {busy ? <SkeletonList count={3} height={150} /> : data && !rows.length ? <EmptyState icon="chart" title="这段时间没有数据" />
          : rows.map((row, index) => (
            <article key={row.user_id} className="card stack-sm">
              <div className="row">
                <span className="avatar" style={index === 0 ? { background: "var(--navy)", color: "#fff" } : undefined}>{index + 1}</span>
                <div className="grow"><p className="card-title ellipsis">{row.name}</p><p className="small muted ellipsis">{row.email}</p></div>
                <span className={`pill ${row.removed_at ? "pill-danger" : row.active ? "pill-green" : "pill-muted"}`}>{row.removed_at ? "已移除" : row.active ? "有效" : "已停用"}</span>
              </div>
              <div className="bar-track" role="img" aria-label={`成交金额 ${formatAmount(row.confirmed_amount)}`}><div style={{ width: `${max ? Math.min(100, Number(row.confirmed_amount) / max * 100) : 0}%` }} /></div>
              <div className="stat-grid">
                <div className="stat"><p className="k">成交金额</p><p className="v">{formatAmount(row.confirmed_amount)}</p></div>
                <div className="stat"><p className="k">已收款金额</p><p className="v">{formatAmount(row.paid_amount)}</p></div>
                <div className="stat"><p className="k">报价数</p><p className="v">{row.quote_count}</p></div>
                <div className="stat"><p className="k">成交单数</p><p className="v">{row.confirmed_count}</p></div>
              </div>
              <p className="small muted">成交货物量：{row.goods?.length ? row.goods.map(item => `${item.quantity} ${item.unit}`).join("、") : "0"}</p>
            </article>
          ))}
        <p className="field-hint">马来西亚时间。成交 = 已成交 + 已收款；已收款为人工标记，不是对账。报价数按首次保存时间计。服务类项目不计入货物量。</p>
      </div>
    </main>
  );
}
