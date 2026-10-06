"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { newInviteToken, teamError } from "../../lib/supabase/invitations";
import { memberLabel } from "../../lib/account-utils";

function inviteStatus(invite) {
  if (invite.accepted_at) return "已接受";
  if (invite.revoked_at) return "已撤销";
  return new Date(invite.expires_at).getTime() <= Date.now() ? "已过期" : "待接受";
}

export default function TeamPage() {
  const [context, setContext] = useState(null);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [share, setShare] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const scope = useRef(null);
  const generation = useRef(0);
  const working = useRef(false);
  const pendingRequest = useRef(null);

  function clear() {
    scope.current = null; pendingRequest.current = null;
    setContext(null); setMembers([]); setInvites([]); setShare(null);
  }

  async function load(requestedCompany, afterOperation = false) {
    if (working.current && !afterOperation) return;
    const version = ++generation.current;
    setLoading(true); setError(""); setMembers([]); setInvites([]);
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (auth.error && auth.error.name !== "AuthSessionMissingError") throw auth.error;
      if (version !== generation.current) return;
      if (!auth.data.user) { clear(); window.location.replace("/account"); return; }
      const result = await client.from("company_members").select("company_id,role,is_primary,companies(id,name)")
        .eq("user_id", auth.data.user.id).eq("active", true);
      if (result.error) throw result.error;
      const companies = (result.data || []).filter(m => m.role === "admin" && m.companies);
      const selected = requestedCompany || scope.current?.companyId || new URLSearchParams(window.location.search).get("company") || companies[0]?.company_id;
      const member = companies.find(m => m.company_id === selected);
      if (!member) throw new Error("此公司没有可用的管理员权限。请回公司账号页确认。");
      const [team, invitations] = await Promise.all([
        client.rpc("get_company_roster", { target_company: selected }),
        client.rpc("get_company_invitations", { target_company: selected })
      ]);
      if (team.error) throw team.error;
      if (invitations.error) throw invitations.error;
      if (version !== generation.current) return;
      if (scope.current?.companyId !== selected || scope.current?.userId !== auth.data.user.id) {
        pendingRequest.current = null; setShare(null); setEmail("");
      }
      const next = { userId: auth.data.user.id, companyId: selected, name: member.companies.name, isPrimary: member.is_primary, companies };
      scope.current = next; setContext(next); setMembers(team.data || []); setInvites(invitations.data || []);
    } catch (err) {
      if (version === generation.current) { clear(); setError(teamError(err)); }
    } finally { if (version === generation.current) setLoading(false); }
  }

  useEffect(() => {
    let subscription, timer;
    try {
      subscription = createClient().auth.onAuthStateChange((event, session) => {
        const changed = scope.current && session?.user.id !== scope.current.userId;
        if (!session || changed) { ++generation.current; clear(); setMessage(""); setError(""); if (event === "SIGNED_OUT" || changed) window.location.replace("/account"); }
        if (event === "INITIAL_SESSION" || event === "SIGNED_OUT" || (event === "SIGNED_IN" && (!scope.current || changed))) {
          clearTimeout(timer); timer = setTimeout(() => void load(), 0);
        }
      }).data.subscription;
      void load();
    } catch (err) { setError(teamError(err)); setLoading(false); }
    const refresh = () => { if (scope.current && !working.current) void load(); };
    const interval = setInterval(refresh, 120000);
    window.addEventListener("focus", refresh);
    return () => { ++generation.current; subscription?.unsubscribe(); clearTimeout(timer); clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, []);

  async function perform(task) {
    if (working.current || loading || !context) return;
    working.current = true; setBusy(true); setError(""); setMessage("");
    const version = generation.current;
    try {
      const result = await task(createClient(), context);
      if (version !== generation.current) return;
      setMessage(result);
      await load(context.companyId, true);
    } catch (err) { if (version === generation.current) setError(teamError(err)); }
    finally { working.current = false; setBusy(false); }
  }

  function generate(event) {
    event.preventDefault();
    void perform(async (client, current) => {
      const normalized = email.trim().toLowerCase();
      let request = pendingRequest.current;
      if (!request || request.companyId !== current.companyId || request.email !== normalized) {
        request = { companyId: current.companyId, email: normalized, token: newInviteToken() };
        pendingRequest.current = request;
      }
      const result = await client.rpc("create_employee_invite", { target_company: current.companyId, invited_email: normalized, invite_token: request.token });
      if (result.error) throw result.error;
      if (scope.current?.userId === current.userId && scope.current?.companyId === current.companyId) {
        setShare({ email: normalized, url: `${window.location.origin}/join#token=${request.token}`, id: result.data });
        pendingRequest.current = null;
      }
      return "邀请已生成，尚未发送。请复制下方链接发送给员工。";
    });
  }

  function manage(member, action, label) {
    if (!window.confirm(`${label} ${member.display_name || member.email}？公司资料与历史报价会保留。移除后必须重新邀请。`)) return;
    void perform(async (client, current) => {
      const result = await client.rpc("manage_company_member", { target_company: current.companyId, employee_id: member.user_id, action });
      if (result.error) throw result.error;
      return `${label}已完成。`;
    });
  }

  return <main className="page accountPage">
    <Link href="/account">← 公司账号</Link>
    <h1>员工与邀请</h1>
    <button disabled={busy || loading} onClick={() => void load()}>刷新员工与邀请</button>
    {loading && <p role="status">正在读取员工资料…</p>}
    {error && <p className="accountError" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {!loading && !context && <p><Link href="/account">请登录公司管理员账号并确认权限</Link></p>}
    {context && <>
      <h2>{context.name}</h2>
      {context.companies.length > 1 && <label>当前公司 <select value={context.companyId} disabled={busy || loading} onChange={e => void load(e.target.value)}>
        {context.companies.map(m => <option key={m.company_id} value={m.company_id}>{m.companies.name}</option>)}
      </select></label>}
      <section className="accountCard">
        <h2>邀请销售员</h2>
        <form onSubmit={generate}>
          <label htmlFor="invite-email">员工邮箱</label>
          <input id="invite-email" type="email" autoComplete="off" required maxLength={254} value={email} disabled={busy || loading} onChange={e => { setEmail(e.target.value); setShare(null); }} />
          <p>链接 7 天有效，只能由此邮箱验证后接受。为同一邮箱生成新链接，会撤销之前尚未接受的链接。</p>
          <button type="submit" disabled={busy || loading || !email.trim()}>{busy ? "处理中…" : "生成邀请链接"}</button>
        </form>
        {share && <div className="notice">
          <p>受邀邮箱：{share.email}。未自动发送邮件。</p>
          <label htmlFor="invite-link">邀请链接</label>
          <input id="invite-link" readOnly value={share.url} onFocus={e => e.target.select()} />
          <button disabled={busy || loading} onClick={async () => {
            try { await navigator.clipboard.writeText(share.url); setMessage("邀请链接已复制，请通过 WhatsApp 或邮件发送给指定员工。"); }
            catch { setMessage("无法自动复制，请点选邀请链接，手动全选复制。"); }
          }}>复制邀请链接</button>
          <p>离开页面后无法恢复原链接；需要时重新生成，新链接会替换旧邀请。</p>
        </div>}
      </section>
      {!loading && <>
        <section className="accountCard"><h2>公司成员（{members.length}）</h2>
          {members.map(member => <div className="teamRow" key={member.user_id}>
            <div><strong>{member.display_name || member.email || "姓名待补填"}</strong><p>{member.email}</p><p>{memberLabel(member)} · {member.removed_at ? "已移除" : member.active ? "可访问" : "已停用"}{member.user_id === context.userId && " · 你"}</p>
              {member.role === "admin" ? <p>产品管理：始终允许（管理员）</p> : <>
                <label className="teamPermission">
                  <input type="checkbox" aria-label={`${member.email} 的产品管理权限`} checked={member.can_manage_products === true} disabled={busy || !!member.removed_at} onChange={e => {
                    const enabled = e.target.checked;
                    if (!window.confirm(`${enabled ? "允许" : "收回"} ${member.email} 在 ${context.name} 的产品管理权限（新增、编辑、删除）？不会改变管理员角色或账号停用状态。`)) return;
                    void perform(async (client, current) => {
                      const result = await client.rpc("set_employee_product_permission", { target_company: current.companyId, employee_id: member.user_id, enabled });
                      if (result.error) throw result.error;
                      return enabled ? "已允许此销售员管理产品。员工刷新后可新增、编辑和删除；停用的账号仍不能访问。" : "已收回产品管理权限，员工仍可查看与分享（账号须未停用）。请让员工刷新页面。";
                    });
                  }} />
                  产品管理（新增、编辑、删除）
                </label>
                {!member.active && <p>账号已停用，此权限暂不生效；恢复访问后按当前设置生效。</p>}
              </>}
            </div>
            {!member.removed_at && !member.is_primary && member.user_id !== context.userId && (member.role === "sales" || context.isPrimary) && <div className="cloudButtons">
              <button disabled={busy || loading} onClick={() => manage(member, member.active ? "disable" : "enable", member.active ? "停用员工" : "恢复员工")}>{member.active ? "停用员工" : "恢复员工"}</button>
              <button disabled={busy || loading} onClick={() => manage(member, "remove", "移除员工")}>移除员工</button>
              {context.isPrimary && <button disabled={busy || loading || !member.active} onClick={() => manage(member, member.role === "admin" ? "demote" : "promote", member.role === "admin" ? "撤销副管理员" : "设为副管理员")}>{member.role === "admin" ? "撤销副管理员" : "设为副管理员"}</button>}
            </div>}
          </div>)}
        </section>
        <section className="accountCard"><h2>邀请记录</h2>
          {!invites.length && <p>尚未发出邀请。</p>}
          {invites.map(invite => <div className="teamRow" key={invite.id}>
            <div><strong>{invite.email}</strong><p>{inviteStatus(invite)} · 到期：{new Date(invite.expires_at).toLocaleString()}</p></div>
            {inviteStatus(invite) === "待接受" && <button disabled={busy} onClick={() => {
              if (!window.confirm(`撤销给 ${invite.email} 的邀请？`)) return;
              void perform(async (client, current) => {
                const result = await client.rpc("revoke_employee_invite", { target_company: current.companyId, invitation_id: invite.id });
                if (result.error) throw result.error;
                if (share?.id === invite.id) setShare(null);
                return "邀请已撤销，原链接不能再加入公司。";
              });
            }}>撤销邀请</button>}
          </div>)}
        </section>
      </>}
    </>}
  </main>;
}
