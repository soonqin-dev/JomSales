"use client";
// AUTH.VERIFY result — docs/auth-spec.md §5.3.
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { pendingInvite } from "../../../lib/supabase/invitations";
import { InlineError } from "../../ui";
import Icon from "../../icons";

export default function AuthCallback() {
  const [state, setState] = useState("checking");
  const [email, setEmail] = useState(""), [sent, setSent] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function finish() {
      try {
        const url = new URL(window.location.href);
        const failure = url.searchParams.get("error") || new URLSearchParams(url.hash.slice(1)).get("error");
        const next = url.searchParams.get("next");
        // The browser client exchanges the PKCE code on initialization.
        const { data, error } = await createClient().auth.getUser();
        window.history.replaceState(null, "", "/auth/callback");
        if (cancelled) return;
        if (failure) setState("invalid");
        else if (data.user && !error) {
          setState("ok");
          setTimeout(() => window.location.replace(next === "settings" ? "/me/security" : pendingInvite() ? "/join" : "/account"), 1200);
        } else setState("unknown");
      } catch { if (!cancelled) setState("unknown"); }
    }
    void finish();
    return () => { cancelled = true; };
  }, []);

  async function resend(event) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("请输入注册时使用的邮箱。"); return; }
    setError("");
    try {
      const result = await createClient().auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (result.error) throw result.error;
      setSent("如果这个邮箱已注册且尚未验证，你会收到新的验证邮件。");
    } catch { setError("暂时无法发送，请稍后再试。"); }
  }

  return (
    <main className="auth-main">
      <div className="auth-logo" style={{ margin: "40px auto 32px" }}>JOM<br />SALES</div>
      <div className="stack">
        {state === "checking" && <><h1 className="auth-title">验证邮箱</h1><p className="auth-sub" role="status">正在确认邮箱验证结果…</p></>}
        {state === "ok" && <div className="empty-state" style={{ color: "var(--ok)" }}><Icon name="check" size={48} /><p role="status">邮箱已验证。正在进入…</p></div>}
        {state === "invalid" && <>
          <h1 className="auth-title">验证链接无效或已过期</h1>
          <form className="stack-sm" onSubmit={resend} noValidate>
            <input className="input" type="email" autoComplete="email" placeholder="example@gmail.com" aria-label="注册邮箱" value={email} onChange={e => setEmail(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-block">重新发送验证邮件</button>
          </form>
          {sent && <div className="notice-box" role="status">{sent}</div>}
          <InlineError>{error}</InlineError>
        </>}
        {state === "unknown" && <><h1 className="auth-title">请返回登录</h1>
          <p className="auth-sub">如果你是在别的浏览器打开的链接，直接回来用邮箱和密码登录即可。</p></>}
        {state !== "checking" && state !== "ok" && <Link href="/account" className="btn btn-secondary btn-block">返回登录页面</Link>}
      </div>
    </main>
  );
}
