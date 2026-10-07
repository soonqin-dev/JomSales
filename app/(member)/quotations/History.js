"use client";
// QTL｜报价记录 + QTR｜报价回收站 — daily-flow-spec §8–9. Lifecycle rules are unchanged (RPC-enforced).
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { listQuotations, manageQuotation } from "../../../lib/supabase/workspace";
import { recentQuotationRange } from "../../../lib/quotation-filters";
import { formatAmount } from "../../quotation-utils";
import { useCurrentQuote, useMember } from "../../member-context";
import { EmptyState, InlineError, MoreMenu, Pager, RefreshButton, SearchBox, Sheet, SkeletonList, StatusPill, TopBar, useConfirm, useToast } from "../../ui";
import EmployeeFilter from "../../EmployeeFilter";
import QuotationCustomerFilter from "../../QuotationCustomerFilter";
import QuotationDateFilter from "../../QuotationDateFilter";
import Icon from "../../icons";

const STATUS = [["all", "全部"], ["pending", "待确认"], ["success", "已成交"], ["paid", "已收款"]];
const EVENTS = { created: "创建", edited: "修改", status: "状态更新", trashed: "移入回收站", restored: "恢复" };
const STATUS_TEXT = { pending: "待确认", success: "已成交", paid: "已收款" };

export default function History() {
  const member = useMember(), quote = useCurrentQuote();
  const router = useRouter(), confirm = useConfirm(), toast = useToast();
  const [trash, setTrash] = useState(false);
  const [rows, setRows] = useState([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""), [status, setStatus] = useState("all");
  const [creator, setCreator] = useState(null), [customer, setCustomer] = useState(null), [dateRange, setDateRange] = useState(() => recentQuotationRange());
  const [page, setPage] = useState(0), [pageInfo, setPageInfo] = useState({ has_more: false, cursor: null });
  const [events, setEvents] = useState({}), [filters, setFilters] = useState(false), [attempt, setAttempt] = useState(0);
  const sequence = useRef(0), working = useRef(false), cursors = useRef([null]);
  const admin = member.role === "admin";
  const defaultRange = recentQuotationRange();

  async function load() {
    const version = ++sequence.current;
    setLoading(true); setError(""); setEvents({});
    try {
      const result = await listQuotations(createClient(), member.companyId, trash, { search, status, creator, customer, ...dateRange, cursor: cursors.current[page] || null });
      if (version === sequence.current) { setRows(result.items); setPageInfo(result); }
    } catch (err) { if (version === sequence.current) setError(`报价读取失败：${err.message}`); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => { clearTimeout(timer); ++sequence.current; }; },
    [trash, search, status, page, creator, customer, dateRange, attempt]);

  function resetPage() { cursors.current = [null]; setPage(0); }
  function go(next) {
    if (working.current || loading || next < 0) return;
    if (next > page) cursors.current[next] = pageInfo.cursor;
    setPage(next); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function act(row, action) {
    if (working.current) return;
    if (action === "trash" && !(await confirm({ title: `删除报价 ${row.number}？`, message: "会移入回收站，15 天内可以恢复，之后自动永久删除。", confirmLabel: "移入回收站", danger: true }))) return;
    if (action === "paid" && !(await confirm({ title: `确认 ${row.number} 已全额收款？`, message: "这是人工记录，不会执行任何付款。", confirmLabel: "标记已收款" }))) return;
    if (row.status === "paid" && ["pending", "success"].includes(action) && !(await confirm({ title: `更正 ${row.number} 的状态？`, message: "更正会记录操作人和时间。", confirmLabel: "更正状态" }))) return;
    working.current = true; setBusy(true);
    try {
      await manageQuotation(createClient(), member.companyId, row, action);
      toast({ trash: "已移入回收站", restore: "报价已恢复", pending: "已标记为待确认", success: "已标记为已成交", paid: "已标记为已收款" }[action]);
      setAttempt(n => n + 1);
    } catch (err) { setError(`操作未确认：${err.message}。请刷新列表核对后重试。`); }
    finally { working.current = false; setBusy(false); }
  }

  async function showEvents(row) {
    if (events[row.id]) { setEvents(prev => { const next = { ...prev }; delete next[row.id]; return next; }); return; }
    try {
      const result = await createClient().from("quotation_events").select("id,action,actor,details,created_at").eq("quote_id", row.id).eq("company_id", member.companyId).order("created_at", { ascending: false }).limit(100);
      if (result.error) throw result.error;
      setEvents(prev => ({ ...prev, [row.id]: result.data }));
    } catch (err) { toast(`记录读取失败：${err.message}`); }
  }

  // QTL.SELECT / duplicate: load into the current quote, then open QTE.
  async function openQuote(row, duplicate = false) {
    if (busy) return;
    if (await quote.open(row.id, { duplicate })) router.push("/cloud/quote");
  }

  async function newQuote() {
    if (await quote.startNew()) router.push("/cloud");
  }

  const filterTags = [
    status !== "all" && { key: "status", label: STATUS.find(s => s[0] === status)[1], clear: () => { resetPage(); setStatus("all"); } },
    customer !== null && { key: "customer", label: `顾客：${customer || "未填写"}`, clear: () => { resetPage(); setCustomer(null); } },
    creator && { key: "creator", label: "已选员工", clear: () => { resetPage(); setCreator(null); setCustomer(null); } },
    (dateRange.dateFrom !== defaultRange.dateFrom || dateRange.dateTo !== defaultRange.dateTo) && { key: "date", label: `${dateRange.dateFrom} 至 ${dateRange.dateTo}`, clear: () => { resetPage(); setDateRange(recentQuotationRange()); } }
  ].filter(Boolean);

  return (
    <main className="app-main">
      {trash
        ? <TopBar title="报价回收站" onBack={() => { resetPage(); setTrash(false); }} actions={<RefreshButton busy={loading} onClick={() => setAttempt(n => n + 1)} />} />
        : <TopBar title="报价记录" subtitle={admin ? "全公司报价" : "我的报价"} actions={<>
          <button type="button" className="text-btn" disabled={busy} onClick={() => { resetPage(); setTrash(true); }}><Icon name="trash" size={18} />回收站</button>
          <RefreshButton busy={loading} onClick={() => setAttempt(n => n + 1)} /></>} />}

      <div className="stack">
        {trash && <div className="notice-box">回收站保留 15 天，到期自动清理。已下载或分享的文件无法撤回。</div>}
        <div className="search-row">
          <SearchBox value={search} onChange={value => { resetPage(); setSearch(value); }} placeholder="编号、客户、员工姓名或邮箱" label="搜索报价" />
          <button type="button" className="filter-btn" onClick={() => setFilters(true)}><Icon name="filter" size={20} />筛选{filterTags.length > 0 && <span className="dot" />}</button>
        </div>
        {filterTags.length > 0 && <div className="chips">{filterTags.map(tag => <span key={tag.key} className="chip removable">{tag.label}
          <button type="button" aria-label={`清除 ${tag.label}`} onClick={tag.clear}><Icon name="x" size={14} /></button></span>)}</div>}
        {error && <InlineError onRetry={() => setAttempt(n => n + 1)}>{error}</InlineError>}

        {loading ? <SkeletonList count={4} height={92} /> : !rows.length ? (
          trash ? <EmptyState icon="trash" title="回收站没有报价" />
            : <EmptyState icon="doc" title={search || filterTags.length ? "没有符合条件的报价" : "还没有报价"} action={!search && !filterTags.length &&
              <button type="button" className="btn btn-primary btn-sm" onClick={newQuote}>去新建</button>} />
        ) : rows.map(row => (
          <article key={row.id} className={`card data-card${trash ? "" : " clickable"}`} onClick={trash ? undefined : () => void openQuote(row)}
            role={trash ? undefined : "button"} tabIndex={trash ? undefined : 0} onKeyDown={trash ? undefined : e => { if (e.key === "Enter") void openQuote(row); }}
            aria-label={trash ? undefined : `打开报价 ${row.number}`}>
            <div className="row-between">
              <div className="title-line"><strong>{row.number}</strong><StatusPill status={row.status} /></div>
              <MoreMenu label={`报价 ${row.number} 的更多操作`} disabled={busy} items={trash ? [
                { label: "恢复报价", icon: "refresh", onSelect: () => void act(row, "restore") },
                { label: events[row.id] ? "收起操作记录" : "查看操作记录", icon: "calendar", onSelect: () => void showEvents(row) }
              ] : [
                { label: "复制为新报价", icon: "copy", onSelect: () => void openQuote(row, true) },
                row.status !== "pending" && { label: row.status === "paid" ? "更正为待确认" : "标记待确认", icon: "refresh", onSelect: () => void act(row, "pending") },
                row.status !== "success" && { label: row.status === "paid" ? "更正为已成交" : "标记已成交", icon: "check", onSelect: () => void act(row, "success") },
                row.status !== "paid" && { label: "标记已收款", icon: "check", onSelect: () => void act(row, "paid") },
                { label: events[row.id] ? "收起操作记录" : "查看操作记录", icon: "calendar", onSelect: () => void showEvents(row) },
                { label: "移入回收站", icon: "trash", danger: true, onSelect: () => void act(row, "trash") }
              ]} />
            </div>
            <p className="meta">{row.customer_name || "未填写客户"}</p>
            <p className="meta">{row.quote_date} · <span className="amount">{formatAmount(row.total_amount)}</span></p>
            {admin && <p className="meta small">建立者：{row.creator_name || row.creator_email || "—"}{row.created_by === member.userId ? "（我）" : ""}</p>}
            {trash && <><p className="meta small">已删除 {new Date(row.deleted_at).toLocaleString("zh-CN", { hour12: false })} · {new Date(new Date(row.deleted_at).getTime() + 15 * 86400000).toLocaleDateString("zh-CN")} 前可恢复</p>
              <button type="button" className="btn btn-secondary btn-sm" style={{ justifySelf: "start" }} disabled={busy} onClick={() => void act(row, "restore")}>恢复</button></>}
            {events[row.id] && <ul className="audit-list" onClick={e => e.stopPropagation()}>
              {events[row.id].map(event => <li key={event.id}>{new Date(event.created_at).toLocaleString("zh-CN", { hour12: false })} · {EVENTS[event.action] || event.action} · {event.details?.actor_name || event.details?.actor_email || "系统"}{event.details?.status ? ` · ${STATUS_TEXT[event.details.status] || event.details.status}` : ""}</li>)}
              {!events[row.id].length && <li>暂无记录</li>}
            </ul>}
          </article>
        ))}
        <Pager page={page} hasMore={pageInfo.has_more} disabled={loading || busy} onPrev={() => go(page - 1)} onNext={() => go(page + 1)} />
      </div>

      {!trash && (loading || rows.length > 0) && <div className="sticky-actions"><button type="button" className="btn btn-primary btn-block" onClick={newQuote}><Icon name="plus" size={20} />新建报价</button></div>}

      {filters && <Sheet title="筛选报价" bottom onClose={() => setFilters(false)} footer={<button type="button" className="btn btn-primary btn-block" onClick={() => setFilters(false)}>完成</button>}>
        <div className="stack-sm"><span className="field-label">状态</span>
          <div className="segmented" role="group" aria-label="报价状态">{STATUS.map(([value, label]) =>
            <button type="button" key={value} aria-pressed={status === value} onClick={() => { resetPage(); setStatus(value); }}>{label}</button>)}</div></div>
        {admin && <EmployeeFilter companyId={member.companyId} value={creator} disabled={busy} onChange={value => { resetPage(); setCreator(value); setCustomer(null); }} />}
        <QuotationCustomerFilter key={creator || "own"} companyId={member.companyId} creator={creator} value={customer} disabled={busy} onChange={value => { if (value === customer) return; resetPage(); setCustomer(value); }} />
        <QuotationDateFilter key={`${dateRange.dateFrom}:${dateRange.dateTo}`} range={dateRange} disabled={busy} onApply={range => { resetPage(); setDateRange(range); }} />
      </Sheet>}
    </main>
  );
}
