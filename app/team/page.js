"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { newInviteToken, teamError } from "../../lib/supabase/invitations";

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
      if (!auth.data.user) { clear(); return; }
      const result = await client.from("company_members").select("company_id,role,companies(id,name)")
        .eq("user_id", auth.data.user.id).eq("active", true);
      if (result.error) throw result.error;
      const companies = (result.data || []).filter(m => m.role === "admin" && m.companies);
      const selected = requestedCompany || scope.current?.companyId || new URLSearchParams(window.location.search).get("company") || companies[0]?.company_id;
      const member = companies.find(m => m.company_id === selected);
      if (!member) throw new Error("此公司没有可用的管理员权限。请回公司账号页确认。");
      const [team, invitations] = await Promise.all([
        client.rpc("get_company_team", { target_company: selected }),
        client.rpc("get_company_invitations", { target_company: selected })
      ]);
      if (team.error) throw team.error;
      if (invitations.error) throw invitations.error;
      if (version !== generation.current) return;
      if (scope.current?.companyId !== selected || scope.current?.userId !== auth.data.user.id) {
        pendingRequest.current = null; setShare(null); setEmail("");
      }
      const next = { userId: auth.data.user.id, companyId: selected, name: member.companies.name, companies };
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
        if (!session || changed) { ++generation.current; clear(); setMessage(""); setError(""); }
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

  return <main className="page accountPage">
    <Link href="/account">← 公司账号</Link>
    <h1>员工与邀请</h1>
    <p className="notice">每位员工使用自己的邮箱登录。销售员可查阅公司产品；报价目前仍保存在各自浏览器。停用仅撤销公司权限，不删除产品，也不能收回已经下载或分享的资料。</p>
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
            <div><strong>{member.email || "邮箱不可用"}</strong><p>{member.role === "admin" ? "管理员" : "销售员"} · {member.active ? "可访问" : "已停用"}{member.user_id === context.userId && " · 你"}</p></div>
            {member.role === "sales" && member.user_id !== context.userId && <button disabled={busy} onClick={() => {
              if (!window.confirm(`${member.active ? "停用" : "恢复"} ${member.email} 在 ${context.name} 的访问权限？公司产品会保留。`)) return;
              void perform(async (client, current) => {
                const result = await client.rpc("set_employee_active", { target_company: current.companyId, employee_id: member.user_id, enabled: !member.active });
                if (result.error) throw result.error;
                return member.active ? "员工的公司权限已停用。已打开的页面会在重新检查权限时更新，已分享内容无法撤回。" : "员工的公司权限已恢复，请让员工刷新公司云端产品。";
              });
            }}>{member.active ? "停用权限" : "恢复权限"}</button>}
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
