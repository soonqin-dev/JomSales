"use client";
// TEAM｜员工管理 + INV｜员工邀请 — docs/pages-spec.md §6. Role boundaries are RPC-enforced.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { newInviteToken, teamError } from "../../../lib/supabase/invitations";
import { memberLabel } from "../../../lib/account-utils";
import { useMember } from "../../member-context";
import { EmptyState, InlineError, MoreMenu, RefreshButton, Sheet, SkeletonList, TopBar, initials, useConfirm, useToast } from "../../ui";
import Icon from "../../icons";

function inviteStatus(invite) {
  if (invite.accepted_at) return ["pill-green", "已接受"];
  if (invite.revoked_at) return ["pill-muted", "已撤销"];
  return new Date(invite.expires_at).getTime() <= Date.now() ? ["pill-muted", "已过期"] : ["pill-warn", "待接受"];
}

export default function TeamPage() {
  const member = useMember(), confirm = useConfirm(), toast = useToast();
  const [members, setMembers] = useState([]), [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const [inviting, setInviting] = useState(false);
  const sequence = useRef(0), working = useRef(false);
  const admin = member.role === "admin", primary = member.is_primary;

  useEffect(() => {
    if (!admin) return;
    const version = ++sequence.current;
    setLoading(true); setError("");
    (async () => {
      try {
        const client = createClient();
        const [team, invitations] = await Promise.all([
          client.rpc("get_company_roster", { target_company: member.companyId }),
          client.rpc("get_company_invitations", { target_company: member.companyId })
        ]);
        if (team.error) throw team.error;
        if (invitations.error) throw invitations.error;
        if (version === sequence.current) { setMembers(team.data || []); setInvites(invitations.data || []); }
      } catch (err) { if (version === sequence.current) setError(teamError(err)); }
      finally { if (version === sequence.current) setLoading(false); }
    })();
    return () => { ++sequence.current; };
  }, [attempt, admin]);

  async function perform(task) {
    if (working.current) return;
    working.current = true; setBusy(true);
    try { const text = await task(createClient()); if (text) toast(text, { duration: 3500 }); setAttempt(n => n + 1); }
    catch (err) { setError(teamError(err)); }
    finally { working.current = false; setBusy(false); }
  }

  async function manage(row, action, label, message, danger = false) {
    if (!(await confirm({ title: `${label}：${row.display_name || row.email}？`, message, confirmLabel: label, danger }))) return;
    await perform(async client => {
      const result = await client.rpc("manage_company_member", { target_company: member.companyId, employee_id: row.user_id, action });
      if (result.error) throw result.error;
      return `${label}已完成`;
    });
  }

  async function setPermission(row, enabled) {
    if (!(await confirm({ title: `${enabled ? "允许" : "收回"}产品管理权限？`, message: `${row.display_name || row.email} ${enabled ? "将可以新增、编辑、删除产品" : "将只能查看和分享产品"}。不会改变角色或账号状态。`, confirmLabel: enabled ? "允许" : "收回", danger: !enabled }))) return;
    await perform(async client => {
      const result = await client.rpc("set_employee_product_permission", { target_company: member.companyId, employee_id: row.user_id, enabled });
      if (result.error) throw result.error;
      return enabled ? "已允许，员工刷新后生效" : "已收回，员工刷新后生效";
    });
  }

  async function revoke(invite) {
    if (!(await confirm({ title: `撤销给 ${invite.email} 的邀请？`, message: "原链接将不能再用来加入公司。", confirmLabel: "撤销邀请", danger: true }))) return;
    await perform(async client => {
      const result = await client.rpc("revoke_employee_invite", { target_company: member.companyId, invitation_id: invite.id });
      if (result.error) throw result.error;
      return "邀请已撤销";
    });
  }

  if (!admin) return <main className="app-main"><TopBar title="员工管理" back="/me" />
    <EmptyState icon="lock" title="这个页面仅供公司管理员使用" action={<Link href="/cloud" className="btn btn-secondary btn-sm">回到产品目录</Link>} /></main>;

  const visible = members.filter(row => !row.removed_at);
  return (
    <main className="app-main">
      <TopBar title="员工管理" subtitle={loading ? " " : `${visible.length} 位成员 · ${member.name}`} back="/admin" actions={<RefreshButton busy={loading} onClick={() => setAttempt(n => n + 1)} />} />
      <div className="stack">
        <button type="button" className="btn btn-primary btn-block" onClick={() => setInviting(true)}><Icon name="plus" size={20} />邀请员工</button>
        {error && <InlineError onRetry={() => setAttempt(n => n + 1)}>{error}</InlineError>}
        {loading ? <SkeletonList count={3} height={96} /> : <>
          <section className="stack-sm" aria-label="公司成员">
            {members.map(row => {
              const me = row.user_id === member.userId;
              const canManage = !row.removed_at && !row.is_primary && !me && (row.role === "sales" || primary);
              return (
                <article key={row.user_id} className={`card${row.active && !row.removed_at ? "" : " muted-card"}`}>
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <span className="avatar" aria-hidden="true">{initials(row.display_name, row.email)}</span>
                    <div className="grow">
                      <div className="title-line" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <strong>{row.display_name || "姓名待补填"}</strong>{me && <span className="chip">我</span>}</div>
                      <p className="small muted ellipsis">{row.email}</p>
                      <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                        <span className="chip">{memberLabel(row)}</span>
                        <span className={`pill ${row.removed_at ? "pill-danger" : row.active ? "pill-green" : "pill-muted"}`}>{row.removed_at ? "已移除" : row.active ? "有效" : "已停用"}</span>
                      </div>
                    </div>
                    {canManage && <MoreMenu label={`${row.email} 的更多操作`} disabled={busy} items={[
                      primary && row.active && { label: row.role === "admin" ? "撤销副管理员" : "设为副管理员", icon: "shield",
                        onSelect: () => void manage(row, row.role === "admin" ? "demote" : "promote", row.role === "admin" ? "撤销副管理员" : "设为副管理员", "公司资料与历史报价不受影响。") },
                      { label: row.active ? "停用员工" : "恢复员工", icon: row.active ? "lock" : "refresh",
                        onSelect: () => void manage(row, row.active ? "disable" : "enable", row.active ? "停用员工" : "恢复员工", row.active ? "停用后员工立即不能访问公司，资料与报价保留。" : "恢复后员工可以再次访问公司。", row.active) },
                      { label: "移除员工", icon: "trash", danger: true, onSelect: () => void manage(row, "remove", "移除员工", "移除后必须重新邀请才能加入。公司资料与历史报价保留。", true) }
                    ]} />}
                  </div>
                  {!row.removed_at && <div className="row-between" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                    <div><p className="small" style={{ fontWeight: 600 }}>产品管理权限</p>
                      <p className="field-hint">{row.role === "admin" ? "管理员始终拥有" : !row.active ? "账号停用中，恢复后按此设置生效" : "新增、编辑、删除产品"}</p></div>
                    {row.role === "admin" ? <span className="small muted">始终拥有</span>
                      : <label className="switch"><input type="checkbox" aria-label={`${row.email} 的产品管理权限`} checked={row.can_manage_products === true} disabled={busy}
                        onChange={e => void setPermission(row, e.target.checked)} /><span /></label>}
                  </div>}
                </article>
              );
            })}
          </section>

          <section className="stack-sm" aria-labelledby="invite-history">
            <h2 className="section-title" id="invite-history">邀请记录</h2>
            {!invites.length ? <p className="small muted">还没有发出邀请。</p> : <div className="list-card">
              {invites.map(invite => {
                const [pill, label] = inviteStatus(invite);
                return <div key={invite.id} className="list-row">
                  <span className="list-text"><span className="list-title" style={{ display: "block", fontSize: 14 }}>{invite.email}</span>
                    <span className="list-desc">到期 {new Date(invite.expires_at).toLocaleDateString("sv-SE")}</span></span>
                  <span className={`pill ${pill}`}>{label}</span>
                  {label === "待接受" && <MoreMenu label="邀请的更多操作" disabled={busy} items={[{ label: "撤销邀请", icon: "trash", danger: true, onSelect: () => void revoke(invite) }]} />}
                </div>;
              })}
            </div>}
          </section>
        </>}
      </div>
      {inviting && <InviteSheet onClose={() => setInviting(false)} onCreated={() => setAttempt(n => n + 1)} />}
    </main>
  );
}

function InviteSheet({ onClose, onCreated }) {
  const member = useMember(), toast = useToast();
  const [email, setEmail] = useState(""), [share, setShare] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(null);

  async function generate(event) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) { setError("请输入有效的员工邮箱。"); return; }
    setBusy(true); setError("");
    try {
      // Retry-safe: a lost response reuses the same token for the same email.
      if (pending.current?.email !== normalized) pending.current = { email: normalized, token: newInviteToken() };
      const result = await createClient().rpc("create_employee_invite", { target_company: member.companyId, invited_email: normalized, invite_token: pending.current.token });
      if (result.error) throw result.error;
      setShare({ email: normalized, url: `${window.location.origin}/join#token=${pending.current.token}` });
      pending.current = null;
      onCreated();
    } catch (err) { setError(teamError(err)); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(share.url); toast("邀请链接已复制"); }
    catch { toast("无法自动复制，请手动选中链接"); }
  }

  return (
    <Sheet title="邀请员工" subtitle="链接 7 天有效，只能由该邮箱接受" onClose={onClose} footer={share
      ? <div className="btn-row"><button type="button" className="btn btn-secondary" onClick={onClose}>完成</button><button type="button" className="btn btn-primary" onClick={copy}><Icon name="copy" size={18} />复制链接</button></div>
      : <button type="submit" form="invite-form" className="btn btn-primary btn-block" disabled={busy}>{busy ? "生成中…" : "生成邀请链接"}</button>}>
      {!share ? <form id="invite-form" className="stack" onSubmit={generate} noValidate>
        <label className="field"><span className="field-label">员工邮箱</span>
          <input className="input" type="email" autoComplete="off" maxLength={254} value={email} disabled={busy} placeholder="example@gmail.com" onChange={e => { setEmail(e.target.value); setError(""); }} /></label>
        <p className="field-hint">为同一邮箱重新生成，会撤销之前还没接受的链接。</p>
        <InlineError>{error}</InlineError>
      </form> : <div className="stack">
        <p className="small">受邀邮箱：<strong>{share.email}</strong></p>
        <input className="input" readOnly value={share.url} onFocus={e => e.target.select()} aria-label="邀请链接" />
        <div className="notice-box">链接需你自己发送给对方，系统不会自动发邮件。离开后无法再查看这条链接。</div>
      </div>}
    </Sheet>
  );
}
