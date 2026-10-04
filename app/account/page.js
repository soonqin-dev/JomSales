"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { pendingInvite } from "../../lib/supabase/invitations";
import { canManageProducts } from "../../lib/supabase/permissions";

export default function AccountPage() {
  const [user, setUser] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [membershipLoaded, setMembershipLoaded] = useState(false);
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [hasInvite, setHasInvite] = useState(false);
  const revision = useRef(0);

  async function refresh() {
    const version = ++revision.current;
    try {
      const client = createClient();
      const { data, error: authError } = await client.auth.getUser();
      if (version !== revision.current) return;
      if (authError && authError.name !== "AuthSessionMissingError") throw authError;
      setUser(data.user || null);
      setMemberships([]);
      setMembershipLoaded(false);
      if (data.user) {
        const result = await client.from("company_members")
          .select("company_id, role, can_manage_products, companies(id, name)")
          .eq("user_id", data.user.id).eq("active", true);
        if (version !== revision.current) return;
        if (result.error) throw result.error;
        setMemberships(result.data || []);
        setMembershipLoaded(true);
      }
    } catch (err) {
      if (version === revision.current) setError(`无法读取账号资料：${err.message}`);
    } finally {
      if (version === revision.current) setLoading(false);
    }
  }

  useEffect(() => {
    let subscription;
    let timer;
    try { setHasInvite(!!pendingInvite()); } catch { /* Auth still works if browser storage is blocked. */ }
    try {
      subscription = createClient().auth.onAuthStateChange(() => {
        clearTimeout(timer);
        timer = setTimeout(() => { void refresh(); }, 0);
      }).data.subscription;
      void refresh();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
    return () => {
      ++revision.current;
      clearTimeout(timer);
      subscription?.unsubscribe();
    };
  }, []);

  async function perform(task) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try { await task(createClient()); }
    catch (err) { setError(err.message || "操作失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  function submitAuth(event) {
    event.preventDefault();
    void perform(async client => {
      const credentials = { email: email.trim(), password };
      const result = mode === "register"
        ? await client.auth.signUp({ ...credentials, options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        } })
        : await client.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      setPassword("");
      if (mode === "register" && !result.data.session) {
        setMessage("注册申请已提交。请检查邮箱（包括垃圾邮件），验证后回来登录。如邮箱已注册，请直接登录。");
      } else {
        window.location.replace(hasInvite ? "/join" : "/");
      }
    });
  }

  return <main className="page accountPage">
    <Link href="/">← 返回产品目录</Link>
    <h1>SalesGo 公司账号</h1>
    <div className="notice">SalesGo 需先登录并创建或加入公司。产品、报价、客户资料与公司品牌统一保存到公司云端。</div>
    {hasInvite && <p className="notice">你正在接受员工邀请，请使用受邀邮箱注册／登录，无需创建公司。<Link href="/join">返回邀请并确认加入 →</Link></p>}
    {error && <p className="accountError" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {loading ? <p role="status">正在读取账号…</p> : user ? <section className="accountCard">
      <h2>已登录</h2><p>{user.email}</p>
      {!membershipLoaded ? <><p>公司资料尚未成功读取，暂时不能创建公司。</p><button disabled={busy} onClick={() => void refresh()}>重新读取公司资料</button></> : memberships.length > 0 ? <>
        <h2>所属公司</h2>
        {memberships.map(member => <div className="notice" key={member.company_id}>
          <strong>{member.companies?.name || "公司资料暂不可用"}</strong>
          <p>角色：{member.role === "admin" ? "管理员" : "销售员"}</p>
          <p>产品权限：{canManageProducts(member) ? "可管理（新增、编辑、删除）" : "仅查看与分享"}</p>
          <p><Link href={`/cloud?company=${member.company_id}`}>进入此公司云端产品 →</Link></p>
          {member.role === "admin" && <p><Link href={`/team?company=${member.company_id}`}>员工与邀请 →</Link></p>}
        </div>)}
        <p><Link href="/cloud">进入公司云端产品 →</Link></p>
      </> : hasInvite ? <p>请返回邀请页面确认加入公司。</p> : <form onSubmit={event => {
        event.preventDefault();
        void perform(async client => {
          const { error: rpcError } = await client.rpc("create_company", { company_name: companyName.trim() });
          if (rpcError) throw rpcError;
          setCompanyName("");
          setMessage("公司已创建，你是该公司的管理员。");
          window.location.replace("/cloud");
        });
      }}>
        <h2>创建你的公司</h2>
        <p>如果你是员工，请等待公司的邀请，不要代公司创建账号。若之前已有公司，请先联系管理员确认访问权限。</p>
        <label htmlFor="company-name">公司名称</label>
        <input id="company-name" value={companyName} onChange={e => setCompanyName(e.target.value)} required maxLength={120} disabled={busy} />
        <button disabled={busy || !companyName.trim()} type="submit">{busy ? "处理中…" : "创建公司"}</button>
      </form>}
      <button disabled={busy} onClick={() => void perform(async client => {
        const result = await client.auth.signOut({ scope: "local" });
        if (result.error) throw result.error;
        ++revision.current;
        setUser(null); setMemberships([]); setPassword("");
        window.location.replace("/account");
      })}>退出此设备的登录</button>
    </section> : <section className="accountCard">
      <div className="accountTabs">
        <button aria-pressed={mode === "login"} disabled={busy} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>登录</button>
        <button aria-pressed={mode === "register"} disabled={busy} onClick={() => { setMode("register"); setError(""); setMessage(""); }}>{hasInvite ? "注册员工账号" : "注册管理员账号"}</button>
      </div>
      <form onSubmit={submitAuth}>
        <label htmlFor="account-email">邮箱</label>
        <input id="account-email" type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={e => setEmail(e.target.value)} />
        <label htmlFor="account-password">密码{mode === "register" && "（至少 8 个字符）"}</label>
        <input id="account-password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={mode === "register" ? 8 : 1} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? "处理中…" : mode === "register" ? "注册并验证邮箱" : "登录"}</button>
      </form>
      <button disabled={busy || !email.trim()} onClick={() => void perform(async client => {
        const result = await client.auth.resend({ type: "signup", email: email.trim(), options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        } });
        if (result.error) throw result.error;
        setMessage("验证邮件请求已提交，请检查邮箱。若未收到，请稍后重试或直接登录。");
      })}>重新发送验证邮件</button>
    </section>}
  </main>;
}
