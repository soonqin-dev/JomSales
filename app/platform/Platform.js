"use client";
// PLT｜平台后台 — docs/pages-spec.md §8. Platform owner only (RPCs require MFA-verified platform access).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { newInviteToken } from "../../lib/supabase/invitations";
import { nullableLimit, memberLabel } from "../../lib/account-utils";
import { EmptyState, InlineError, MoreMenu, Pager, Sheet, SkeletonList, useConfirm, useToast } from "../ui";
import Icon from "../icons";

const states = { trial: ["试用", "pill-warn"], active: ["正常", "pill-green"], expired: ["到期", "pill-muted"], suspended: ["停用", "pill-danger"] };
const dateInput = date => date ? new Date(new Date(date).getTime() - new Date(date).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";

export default function Platform() {
  const confirm = useConfirm(), toast = useToast();
  const [allowed, setAllowed] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [rows, setRows] = useState([]);
  const [search, setSearch] = useState(""), [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false), [name, setName] = useState(""), [email, setEmail] = useState(""), [invite, setInvite] = useState(null);
  const [selected, setSelected] = useState(null), [draft, setDraft] = useState(null), [members, setMembers] = useState([]), [audit, setAudit] = useState([]);
  const [primaryEmail, setPrimaryEmail] = useState("");
  const sequence = useRef(0), working = useRef(false), identity = useRef(null), pending = useRef(null);
  const fail = err => { if (err) throw err; };
  async function rpc(client, method, args) { const result = await client.rpc(method, args); fail(result.error); return result.data; }

  async function load(nextOffset = offset, afterOperation = false) {
    if (working.current && !afterOperation) return;
    const version = ++sequence.current; setLoading(true); setError("");
    try {
      const client = createClient(), auth = await client.auth.getUser();
      if (auth.error || !auth.data.user) { window.location.replace("/account"); return; }
      if (identity.current && identity.current !== auth.data.user.id) throw new Error("账号已改变，请重新登录。");
      identity.current = auth.data.user.id;
      if (await rpc(client, "is_platform_admin") !== true) throw new Error("此账号没有平台权限，或尚未通过双重验证。");
      const data = await rpc(client, "platform_list_companies", { search_text: search.trim(), page_offset: nextOffset });
      if (version !== sequence.current) return;
      setAllowed(true); setRows(data || []); setOffset(nextOffset);
    } catch (err) {
      if (version === sequence.current) { setAllowed(false); setRows([]); setSelected(null); setDraft(null); setMembers([]); setAudit([]); setInvite(null); setError(err.message); }
    } finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    void load(0);
    const subscription = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (identity.current && session?.user.id !== identity.current)) {
        ++sequence.current; setAllowed(false); setRows([]); setMembers([]); setAudit([]); setDraft(null); setInvite(null); pending.current = null; window.location.replace("/account");
      }
    }).data.subscription;
    return () => { ++sequence.current; subscription.unsubscribe(); };
  }, []);

  async function run(task) {
    if (working.current || !allowed || loading) return false;
    working.current = true; setBusy(true); setError("");
    const version = sequence.current;
    try {
      const text = await task(createClient());
      if (version !== sequence.current) return false;
      if (text) toast(text, { duration: 3500 });
      await load(offset, true);
      return true;
    } catch (err) { if (version === sequence.current) setError(`操作未确认：${err.message}。请核对记录后重试。`); return false; }
    finally { working.current = false; setBusy(false); }
  }
  function open(row) {
    void run(async client => {
      const [team, records] = await Promise.all([rpc(client, "platform_company_members", { target_company: row.id }), rpc(client, "platform_audit_list", { target_company: row.id })]);
      setSelected(row); setMembers(team || []); setAudit(records || []); setPrimaryEmail("");
      setDraft({ state: row.service_state, until: dateInput(row.service_until), plan: row.plan,
        seats: row.employee_limit ?? "", products: row.product_limit ?? "", storage: row.storage_limit_mb ?? "", features: JSON.stringify(row.features || {}, null, 2) });
      return "";
    });
  }
  async function memberAction(row, action, label, message, danger = false) {
    if (!(await confirm({ title: `${label}：${row.display_name || row.email}？`, message, confirmLabel: label, danger }))) return;
    await run(async client => {
      await rpc(client, "platform_manage_member", { target_company: selected.id, employee_id: row.user_id, action });
      setMembers(await rpc(client, "platform_company_members", { target_company: selected.id }));
      setAudit(await rpc(client, "platform_audit_list", { target_company: selected.id }));
      return `${label}已完成`;
    });
  }
  function showInvite(request) {
    setInvite({ company: request.name || selected?.name, email: request.email, url: `${window.location.origin}/join#token=${request.token}` });
    pending.current = null;
  }
  async function createCompany(event) {
    event.preventDefault();
    await run(async client => {
      const normalized = email.trim().toLowerCase(), companyName = name.trim();
      if (!companyName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("请填写公司名称和有效的正管理员邮箱。");
      // Retry-safe: the same company id and token are reused until the inputs change.
      if (!pending.current || pending.current.kind !== "create" || pending.current.email !== normalized || pending.current.name !== companyName)
        pending.current = { kind: "create", id: crypto.randomUUID(), name: companyName, email: normalized, token: newInviteToken() };
      const request = pending.current;
      await rpc(client, "platform_create_company", { target_company: request.id, company_name: request.name, admin_email: request.email, invite_token: request.token });
      showInvite(request); setName(""); setEmail("");
      return "公司已开通";
    });
  }
  async function saveCompany(event) {
    event.preventDefault();
    if (!(await confirm({ title: "保存公司设置？", message: "停用、到期或已过服务期限会阻止公司访问，资料不会删除。", confirmLabel: "保存" }))) return;
    const ok = await run(async client => {
      const features = JSON.parse(draft.features);
      if (!features || Array.isArray(features) || typeof features !== "object") throw new Error("功能配置需为 JSON 对象。");
      await rpc(client, "platform_update_company", { target_company: selected.id, expected_revision: selected.access_revision,
        new_state: draft.state, new_until: draft.until ? new Date(draft.until).toISOString() : null, new_plan: draft.plan,
        seats: nullableLimit(draft.seats), product_cap: nullableLimit(draft.products), storage_mb: nullableLimit(draft.storage), feature_config: features });
      return "公司设置已保存";
    });
    if (ok) { setSelected(null); setDraft(null); setMembers([]); setAudit([]); }
  }
  async function invitePrimary(event) {
    event.preventDefault();
    await run(async client => {
      const normalized = primaryEmail.trim().toLowerCase();
      if (!pending.current || pending.current.kind !== "primary" || pending.current.id !== selected.id || pending.current.email !== normalized)
        pending.current = { kind: "primary", id: selected.id, email: normalized, token: newInviteToken() };
      const request = pending.current;
      await rpc(client, "platform_primary_invite", { target_company: selected.id, admin_email: request.email, invite_token: request.token });
      showInvite(request);
      return "新的正管理员邀请已生成，之前未接受的已撤销";
    });
  }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(invite.url); toast("链接已复制"); } catch { toast("请手动选中链接复制"); }
  }

  return (
    <>
      <header style={{ background: "var(--navy-ink)", color: "#fff" }}>
        <div className="row-between" style={{ width: "min(100%, 560px)", margin: "0 auto", padding: "14px 16px" }}>
          <div className="row"><Link href="/account" className="circle-btn sm" style={{ background: "rgba(255,255,255,.15)" }} aria-label="返回"><Icon name="arrowLeft" size={18} /></Link>
            <div><p style={{ fontWeight: 700 }}>平台管理</p><p className="small" style={{ opacity: .7 }}>JomSales 平台负责人</p></div></div>
          <Icon name="shield" size={22} />
        </div>
      </header>
      <main className="app-main no-nav">
        <div className="stack">
          <InlineError>{error}</InlineError>
          {loading && !allowed ? <SkeletonList count={3} height={96} /> : !allowed ? (
            <div className="card stack-sm">
              <p className="card-title">无法进入平台后台</p>
              <p className="small muted">需要平台授权，并在「账号安全」完成双重验证。</p>
              <div className="btn-row"><button type="button" className="btn btn-secondary btn-sm" onClick={() => void load(0)}>重新检查</button>
                {/* /settings works without any usable company (all companies may be suspended). */}
                <Link href="/settings" className="btn btn-primary btn-sm">前往双重验证</Link></div>
            </div>
          ) : <>
            <form className="search-row" onSubmit={e => { e.preventDefault(); void load(0); }}>
              <div className="searchbox"><Icon name="search" size={20} /><input value={search} maxLength={120} placeholder="搜索公司" aria-label="搜索公司" disabled={busy} onChange={e => setSearch(e.target.value)} /></div>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || loading}>查询</button>
            </form>
            <button type="button" className="btn btn-primary btn-block" onClick={() => { setInvite(null); setCreating(true); }}><Icon name="plus" size={20} />开通公司</button>
            {invite && !creating && !selected && <InviteResult invite={invite} onCopy={copyInvite} />}
            {loading ? <SkeletonList count={3} height={110} /> : !rows.length ? <EmptyState icon="building" title="没有符合的公司" /> : rows.map(row => {
              const [stateLabel, statePill] = states[row.service_state] || ["未知", "pill-muted"];
              return (
                <button key={row.id} type="button" className="card data-card" style={{ textAlign: "left" }} disabled={busy} onClick={() => open(row)}>
                  <div className="row-between"><strong className="card-title">{row.name}</strong><Icon name="chevronRight" size={18} /></div>
                  <div className="row" style={{ flexWrap: "wrap" }}><span className="chip">{row.plan}</span><span className={`pill ${statePill}`}>{stateLabel}</span>
                    {row.service_until && <span className="small muted">截止 {new Date(row.service_until).toLocaleDateString("sv-SE")}</span>}</div>
                  <p className="meta small">正管理员：{row.admin_email || "待接受邀请"}</p>
                  <p className="meta small">成员 {row.members} · 产品 {row.products} · 图片约 {(Number(row.storage_bytes) / 1048576).toFixed(1)} MB</p>
                </button>
              );
            })}
            <Pager page={offset / 50} hasMore={rows.length >= 50} disabled={busy || loading} onPrev={() => void load(Math.max(0, offset - 50))} onNext={() => void load(offset + 50)} />
          </>}
        </div>
      </main>

      {creating && <Sheet title="开通公司" subtitle="开通后把管理员邀请链接发给对方" onClose={() => setCreating(false)} footer={invite
        ? <button type="button" className="btn btn-primary btn-block" onClick={() => setCreating(false)}>完成</button>
        : <button type="submit" form="plt-new" className="btn btn-primary btn-block" disabled={busy}>{busy ? "处理中…" : "开通并生成管理员邀请"}</button>}>
        {invite ? <InviteResult invite={invite} onCopy={copyInvite} /> : <form id="plt-new" className="stack" onSubmit={createCompany} noValidate>
          <label className="field"><span className="field-label">公司名称*</span><input className="input" maxLength={120} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
          <label className="field"><span className="field-label">正管理员邮箱*</span><input className="input" type="email" maxLength={254} value={email} disabled={busy} onChange={e => setEmail(e.target.value)} /></label>
          <InlineError>{error}</InlineError>
        </form>}
      </Sheet>}

      {selected && draft && <Sheet title={selected.name} subtitle="公司设置与成员" onClose={() => { setSelected(null); setDraft(null); setInvite(null); }} footer={
        <button type="submit" form="plt-company" className="btn btn-primary btn-block" disabled={busy}>{busy ? "保存中…" : "保存公司设置"}</button>}>
        <form id="plt-company" className="stack" onSubmit={saveCompany}>
          <div className="fields-2">
            <label className="field"><span className="field-label">服务状态</span><select className="input" value={draft.state} disabled={busy} onChange={e => setDraft({ ...draft, state: e.target.value })}>
              {Object.entries(states).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="field"><span className="field-label">配套</span><select className="input" value={draft.plan} disabled={busy} onChange={e => setDraft({ ...draft, plan: e.target.value })}>
              {["Lite", "Pro", "Premium", "Customize"].map(plan => <option key={plan}>{plan}</option>)}</select></label>
          </div>
          <label className="field"><span className="field-label">服务截止（本地时间，留空不设期限）</span>
            <input className="input" type="datetime-local" value={draft.until} disabled={busy} onChange={e => setDraft({ ...draft, until: e.target.value })} /></label>
          <div className="fields-2">
            <label className="field"><span className="field-label">成员额度</span><input className="input" type="number" min={1} max={100000} placeholder="不限" value={draft.seats} disabled={busy} onChange={e => setDraft({ ...draft, seats: e.target.value })} /></label>
            <label className="field"><span className="field-label">产品额度</span><input className="input" type="number" min={1} max={10000000} placeholder="不限" value={draft.products} disabled={busy} onChange={e => setDraft({ ...draft, products: e.target.value })} /></label>
          </div>
          <p className="field-hint">成员额度含管理员及停用成员；超过产品额度不会删除旧产品。</p>
          <details className="fold"><summary>高级（预留，尚未生效）<Icon name="chevronDown" size={18} /></summary><div className="fold-body">
            <label className="field"><span className="field-label">图片额度（MB）</span><input className="input" type="number" min={1} max={100000000} value={draft.storage} disabled={busy} onChange={e => setDraft({ ...draft, storage: e.target.value })} /></label>
            <label className="field"><span className="field-label">功能配置（JSON）</span><textarea className="input" maxLength={3000} rows={4} value={draft.features} disabled={busy} onChange={e => setDraft({ ...draft, features: e.target.value })} /></label>
          </div></details>
        </form>

        <section className="stack-sm"><h3 className="section-title">成员</h3>
          <div className="list-card">{members.map(row => <div key={row.user_id} className="list-row">
            <span className="list-text"><span className="list-title" style={{ display: "block", fontSize: 14 }}>{row.display_name || row.email}</span>
              <span className="list-desc">{row.email} · {memberLabel(row)} · {row.removed_at ? "已移除" : row.active ? "有效" : "停用"}</span></span>
            {!row.removed_at && !row.is_primary && <MoreMenu label={`${row.email} 的更多操作`} disabled={busy} items={[
              row.active && { label: "设为正管理员", icon: "shield", onSelect: () => void memberAction(row, "make_primary", "更换为正管理员", "原正管理员会成为副管理员。") },
              { label: row.active ? "停用成员" : "恢复成员", icon: row.active ? "lock" : "refresh", onSelect: () => void memberAction(row, row.active ? "disable" : "enable", row.active ? "停用成员" : "恢复成员", "历史资料保留。", row.active) },
              { label: "移除成员", icon: "trash", danger: true, onSelect: () => void memberAction(row, "remove", "移除成员", "历史资料保留，需重新邀请才能加入。", true) }
            ]} />}
          </div>)}</div>
        </section>

        {!members.some(row => row.is_primary) && <form className="stack-sm" onSubmit={invitePrimary}>
          <label className="field"><span className="field-label">邀请正管理员（首次或重新邀请）</span>
            <input className="input" type="email" required maxLength={254} value={primaryEmail} disabled={busy} onChange={e => setPrimaryEmail(e.target.value)} /></label>
          <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>生成管理员邀请</button>
        </form>}
        {invite && <InviteResult invite={invite} onCopy={copyInvite} />}

        <details className="fold"><summary>平台操作记录<Icon name="chevronDown" size={18} /></summary>
          <ul className="audit-list">{audit.map(record => <li key={record.id}>{new Date(record.created_at).toLocaleString("zh-CN", { hour12: false })} · {record.action}<br /><span style={{ overflowWrap: "anywhere" }}>{JSON.stringify(record.details)}</span></li>)}
            {!audit.length && <li>暂无记录</li>}</ul>
        </details>
        <InlineError>{error}</InlineError>
      </Sheet>}
    </>
  );
}

function InviteResult({ invite, onCopy }) {
  return (
    <section className="card flat stack-sm">
      <p className="card-title">管理员邀请已生成</p>
      <p className="small muted">{invite.company} · {invite.email} · 7 天有效</p>
      <input className="input" aria-label="管理员邀请链接" readOnly value={invite.url} onFocus={e => e.target.select()} />
      <button type="button" className="btn btn-primary btn-sm" onClick={onCopy}><Icon name="copy" size={16} />复制链接</button>
      <p className="field-hint">链接需自行发送，系统不会自动发邮件。</p>
    </section>
  );
}
