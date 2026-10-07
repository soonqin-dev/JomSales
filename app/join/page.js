"use client";
// AUTH.JOIN — docs/auth-spec.md §5.5. Flow unchanged; adds the email-mismatch state.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { captureInvite, INVITE_KEY, teamError } from "../../lib/supabase/invitations";
import { InlineError, SkeletonList, useToast } from "../ui";
import Icon from "../icons";

export default function JoinPage() {
  const toast = useToast();
  const [user, setUser] = useState(null), [invite, setInvite] = useState(null), [joined, setJoined] = useState(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const token = useRef(null), identity = useRef(null), generation = useRef(0), working = useRef(false);

  async function load() {
    if (working.current || !token.current) return;
    const version = ++generation.current;
    setLoading(true); setError(""); setInvite(null); setJoined(null);
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (auth.error && auth.error.name !== "AuthSessionMissingError") throw auth.error;
      if (version !== generation.current) return;
      identity.current = auth.data.user?.id || null; setUser(auth.data.user || null);
      if (!auth.data.user) return;
      const result = await client.rpc("get_join_invitation", { invite_token: token.current });
      if (result.error) throw result.error;
      if (version === generation.current) {
        if (!result.data?.[0]) throw new Error("Invitation invalid.");
        setInvite(result.data[0]);
      }
    } catch (err) { if (version === generation.current) setError(teamError(err)); }
    finally { if (version === generation.current) setLoading(false); }
  }

  useEffect(() => {
    let subscription, timer;
    try {
      token.current = captureInvite();
      subscription = createClient().auth.onAuthStateChange((event, session) => {
        const changed = (session?.user.id || null) !== identity.current;
        if (!session || changed) { ++generation.current; identity.current = session?.user.id || null; setUser(session?.user || null); setInvite(null); setJoined(null); setError(""); }
        if (event === "INITIAL_SESSION" || event === "SIGNED_OUT" || (event === "SIGNED_IN" && changed)) { clearTimeout(timer); timer = setTimeout(() => void load(), 0); }
      }).data.subscription;
      void load();
    } catch (err) { setError(err.message); setLoading(false); }
    return () => { ++generation.current; clearTimeout(timer); subscription?.unsubscribe(); };
  }, []);

  async function accept() {
    if (working.current || !invite || !user) return;
    working.current = true; setBusy(true); setError("");
    const version = generation.current;
    try {
      const result = await createClient().rpc("accept_employee_invite", { invite_token: token.current });
      if (result.error) throw result.error;
      if (version !== generation.current) return;
      if (!result.data) throw new Error("加入结果未确认，请刷新后重试。");
      // Do not remove an invitation opened in a different tab in the meantime.
      if (window.sessionStorage.getItem(INVITE_KEY) === token.current) window.sessionStorage.removeItem(INVITE_KEY);
      setJoined(result.data); setInvite(null);
    } catch (err) { if (version === generation.current) setError(teamError(err)); }
    finally { working.current = false; setBusy(false); }
  }

  // AUTH.JOIN.CHANGE_ACCOUNT: sign out, keep the invitation in this tab, log in again.
  async function changeAccount() {
    setBusy(true);
    try { const result = await createClient().auth.signOut({ scope: "local" }); if (result.error) throw result.error; window.location.replace("/account"); }
    catch (err) { toast(`退出失败：${err.message}`); setBusy(false); }
  }

  const mismatch = invite && user && invite.email && user.email && invite.email.toLowerCase() !== user.email.toLowerCase();
  return (
    <main className="auth-main">
      <div className="auth-logo" style={{ margin: "40px auto 32px" }}>JOM<br />SALES</div>
      <div className="stack">
        <h1 className="auth-title">{joined ? "已加入公司" : "加入公司"}</h1>
        {loading && <SkeletonList count={2} height={64} />}
        {error && <InlineError>{error}</InlineError>}
        {error && user && <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={changeAccount}>换账号</button>}
        {!loading && !user && !error && <>
          <p className="auth-sub">请先登录受邀邮箱。没有账号？用管理员指定的邮箱注册并验证，再回到这里接受邀请。</p>
          <Link href="/account" className="btn btn-primary btn-block">登录／注册</Link>
        </>}
        {!loading && invite && !joined && <section className="card stack-sm">
          <p className="card-title">{invite.company_name}</p>
          <p className="small muted">受邀邮箱：{invite.email}</p>
          {mismatch && <p className="small muted">当前登录：{user.email}</p>}
          <p className="small muted">角色：{invite.invite_role === "primary" ? "正管理员" : "销售员（产品管理权限由管理员设置）"}</p>
          {!invite.already_accepted && <p className="small muted">到期：{new Date(invite.expires_at).toLocaleDateString("sv-SE")}</p>}
        </section>}
        {!loading && invite && mismatch && <>
          <InlineError>这个邀请是发给 {invite.email} 的。你现在登录的是 {user.email}。</InlineError>
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={changeAccount}>换账号</button>
        </>}
        {!loading && invite && !mismatch && !joined && <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void accept()}>
          {busy ? "正在加入…" : invite.already_accepted ? "重新确认公司权限" : "接受邀请并加入公司"}</button>}
        {joined && <>
          <div className="empty-state" style={{ color: "var(--ok)" }}><Icon name="check" size={48} /><p>你已获得公司访问权限。</p></div>
          <Link href={`/cloud?company=${joined}`} className="btn btn-primary btn-block">进入公司</Link>
        </>}
        {!loading && !joined && token.current && (error || !invite) && user && <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={() => void load()}>重新检查邀请</button>}
      </div>
    </main>
  );
}
