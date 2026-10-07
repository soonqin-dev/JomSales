"use client";
// CUS｜客户通讯录 + CUE｜新增／编辑客户 — docs/pages-spec.md §1.
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { listCustomers, saveCustomer, setCustomerActive } from "../../../lib/supabase/customers";
import { useMember } from "../../member-context";
import { EmptyState, InlineError, MoreMenu, Pager, SearchBox, Sheet, SkeletonList, TopBar, useConfirm, useToast } from "../../ui";
import EmployeeFilter from "../../EmployeeFilter";
import Icon from "../../icons";

const PAGE = 50;
const FIELDS = [["name", "姓名*", 120, "text"], ["phone", "电话", 40, "tel"], ["company", "公司", 120, "text"], ["email", "邮箱", 254, "email"], ["address", "地址", 1000, "textarea"]];

export default function Customers() {
  const member = useMember(), confirm = useConfirm(), toast = useToast();
  const [rows, setRows] = useState([]), [total, setTotal] = useState(0), [offset, setOffset] = useState(0);
  const [search, setSearch] = useState(""), [inactive, setInactive] = useState(false), [owner, setOwner] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(null), [editor, setEditor] = useState(null), [filters, setFilters] = useState(false);
  const sequence = useRef(0), working = useRef(false);
  const admin = member.role === "admin";

  useEffect(() => {
    const version = ++sequence.current;
    setLoading(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const data = await listCustomers(createClient(), member.companyId, search, inactive, offset, owner);
        if (version === sequence.current) { setRows(data.items); setTotal(Number(data.total)); }
      } catch (err) { if (version === sequence.current) setError(`客户读取失败：${err.message}`); }
      finally { if (version === sequence.current) setLoading(false); }
    }, 250);
    return () => { ++sequence.current; clearTimeout(timer); };
  }, [search, inactive, offset, owner, attempt]);

  // CPK「去新增客户」arrives with ?new=1.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("new") === "1") {
      setEditor({ row: null });
      url.searchParams.delete("new"); window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }
  }, []);

  async function toggleActive(row) {
    if (working.current) return;
    if (!(await confirm({ title: `${row.active ? "停用" : "恢复"} ${row.name}？`, message: "历史报价不受影响。", confirmLabel: row.active ? "停用客户" : "恢复客户", danger: row.active }))) return;
    working.current = true; setBusy(true);
    try { await setCustomerActive(createClient(), member, row, !row.active); toast(row.active ? "客户已停用" : "客户已恢复"); setAttempt(n => n + 1); }
    catch (err) { toast(err.message); }
    finally { working.current = false; setBusy(false); }
  }

  const filtered = inactive || owner;

  return (
    <main className="app-main">
      <TopBar title="客户" subtitle={loading ? " " : `共 ${total} 位${admin ? " · 全公司" : ""}`} actions={
        <button type="button" className="circle-btn" aria-label="新增客户" onClick={() => setEditor({ row: null })}><Icon name="plus" size={22} strokeWidth={2.25} /></button>} />
      <div className="stack">
        <div className="search-row">
          <SearchBox value={search} onChange={value => { setSearch(value); setOffset(0); }} placeholder="搜索姓名、公司、电话" label="搜索客户" />
          <button type="button" className="filter-btn" onClick={() => setFilters(true)}><Icon name="filter" size={20} />筛选{filtered && <span className="dot" />}</button>
        </div>
        {error && <InlineError onRetry={() => setAttempt(n => n + 1)}>{error}</InlineError>}
        {loading ? <SkeletonList count={5} height={64} /> : !rows.length ? (
          search || filtered ? <EmptyState title="没有符合的客户" />
            : <EmptyState icon="phone" title="还没有客户" action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setEditor({ row: null })}>新增客户</button>} />
        ) : rows.map(row => {
          const mine = row.created_by === member.userId, expanded = open === row.id;
          return (
            <article key={row.id} className={`card data-card${row.active ? "" : " muted-card"}`}>
              <div className="row-between" style={{ alignItems: "flex-start" }}>
                <button type="button" className="grow" style={{ border: 0, background: "none", padding: 0, textAlign: "left" }} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : row.id)}>
                  <span className="title-line"><strong>{row.name}</strong>{!row.active && <span className="chip">已停用</span>}{!mine && <span className="chip">只读</span>}</span>
                  <span className="meta" style={{ display: "block" }}>{[row.company, row.phone].filter(Boolean).join(" · ") || "—"}</span>
                </button>
                {mine && <MoreMenu label={`${row.name} 的更多操作`} disabled={busy} items={[
                  { label: "编辑客户", icon: "sliders", onSelect: () => setEditor({ row }) },
                  { label: row.active ? "停用客户" : "恢复客户", icon: row.active ? "lock" : "refresh", danger: row.active, onSelect: () => void toggleActive(row) }
                ]} />}
              </div>
              {expanded && <div className="stack-sm" style={{ paddingTop: 6 }}>
                {row.phone && <a className="text-btn" href={`tel:${row.phone}`}><Icon name="phone" size={16} />{row.phone}</a>}
                {row.email && <a className="text-btn" href={`mailto:${row.email}`}><Icon name="send" size={16} />{row.email}</a>}
                {row.address && <p className="meta preserveLines">{row.address}</p>}
                <p className="meta small">建立者：{row.owner_name || row.owner_email || "—"}{mine ? "（我）" : ""} · {row.active ? "有效" : "已停用"}</p>
              </div>}
            </article>
          );
        })}
        <Pager page={Math.floor(offset / PAGE)} hasMore={offset + PAGE < total} disabled={loading || busy}
          onPrev={() => setOffset(v => Math.max(0, v - PAGE))} onNext={() => setOffset(v => v + PAGE)} />
      </div>

      {filters && <Sheet title="筛选客户" bottom onClose={() => setFilters(false)} footer={<button type="button" className="btn btn-primary btn-block" onClick={() => setFilters(false)}>完成</button>}>
        <div className="stack-sm"><span className="field-label">显示范围</span>
          <div className="segmented" role="group" aria-label="显示范围">
            <button type="button" aria-pressed={!inactive} onClick={() => { setInactive(false); setOffset(0); }}>有效客户</button>
            <button type="button" aria-pressed={inactive} onClick={() => { setInactive(true); setOffset(0); }}>包含停用</button>
          </div></div>
        {admin && <EmployeeFilter companyId={member.companyId} label="建立者" value={owner} onChange={value => { setOwner(value); setOffset(0); }} />}
      </Sheet>}
      {editor && <CustomerEditor row={editor.row} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); toast("客户已保存，旧报价不会改变"); setAttempt(n => n + 1); }} />}
    </main>
  );
}

function CustomerEditor({ row, onClose, onSaved }) {
  const member = useMember(), confirm = useConfirm();
  const initial = useRef(row ? { ...row } : { id: crypto.randomUUID(), name: "", company: "", phone: "", email: "", address: "" });
  const [draft, setDraft] = useState(initial.current), [saving, setSaving] = useState(false), [error, setError] = useState(""), [nameError, setNameError] = useState("");
  const dirty = FIELDS.some(([key]) => (draft[key] || "") !== (initial.current[key] || ""));

  async function close() {
    if (saving) return;
    if (dirty && !(await confirm({ title: "放弃修改？", message: "客户资料还没保存。", cancelLabel: "继续编辑", confirmLabel: "放弃", danger: true }))) return;
    onClose();
  }
  async function save(event) {
    event.preventDefault();
    if (!draft.name.trim()) { setNameError("请填写客户姓名"); return; }
    setSaving(true); setError("");
    try { await saveCustomer(createClient(), member, draft, row); onSaved(); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <Sheet title={row ? "编辑客户" : "新增客户"} subtitle="只有你建立的客户可以修改" onClose={close} footer={<>
      <InlineError>{error}</InlineError>
      <button type="submit" form="cue-form" className="btn btn-primary btn-block" disabled={saving}>{saving ? "保存中…" : "保存客户"}</button></>}>
      <form id="cue-form" className="stack" onSubmit={save} noValidate>
        {FIELDS.map(([key, label, max, type]) => <label key={key} className="field"><span className="field-label">{label}</span>
          {type === "textarea"
            ? <textarea className="input" rows={3} maxLength={max} value={draft[key] || ""} onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
            : <input className="input" type={type} maxLength={max} value={draft[key] || ""} aria-invalid={key === "name" && !!nameError}
              onChange={e => { setDraft({ ...draft, [key]: e.target.value }); if (key === "name") setNameError(""); }} />}
          {key === "name" && nameError && <span className="field-error">{nameError}</span>}
        </label>)}
      </form>
    </Sheet>
  );
}
