"use client";
// AUTH.RESET — docs/auth-spec.md §5.4. Keeps the confirmation field: resetting is high-risk.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { validatePassword, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "../../../lib/account-utils";
import { InlineError, PasswordInput } from "../../ui";

export default function ResetPassword() {
  const [phase, setPhase] = useState("checking"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [password, setPassword] = useState(""), [again, setAgain] = useState("");
  const [factor, setFactor] = useState(null), [code, setCode] = useState("");
  const working = useRef(false);

  useEffect(() => {
    let live = true;
    async function check() {
      try {
        const location = new URL(window.location.href);
        const failure = location.searchParams.get("error") || new URLSearchParams(location.hash.slice(1)).get("error");
        // createBrowserClient exchanges the PKCE recovery code before getUser.
        const result = await createClient().auth.getUser();
        window.history.replaceState(null, "", "/auth/reset");
        if (!live) return;
        if (failure || result.error || !result.data.user) { setPhase("invalid"); return; }
        const factors = await createClient().auth.mfa.listFactors();
        if (!live) return;
        if (factors.error) throw factors.error;
        setFactor(factors.data?.totp?.[0] || null);
        setPhase("ready");
      } catch { if (live) setPhase("invalid"); }
    }
    void check();
    return () => { live = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (working.current) return;
    setError("");
    try { validatePassword(password, again); }
    catch (err) { setError(password !== again ? "两次输入的密码不一致。" : err.message); return; }
    working.current = true; setBusy(true);
    try {
      const client = createClient();
      if (factor) {
        const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
        if (verified.error) throw new Error("验证码不正确，请重试。");
      }
      const result = await client.auth.updateUser({ password });
      if (result.error) throw result.error;
      const logout = await client.auth.signOut({ scope: "global" });
      setPassword(""); setAgain("");
      if (logout.error) { setPhase("unconfirmed"); return; }
      window.location.replace("/account?reset=1");
    } catch (err) { setError(err.message || "设置失败，请重试。"); }
    finally { working.current = false; setBusy(false); }
  }

  return (
    <main className="auth-main">
      <div className="auth-logo" style={{ margin: "40px auto 32px" }}>JOM<br />SALES</div>
      <div className="stack">
        <h1 className="auth-title">重置密码</h1>
        {phase === "checking" && <p className="auth-sub" role="status">正在检查链接…</p>}
        {phase === "invalid" && <InlineError>链接失效或尚未登录。请重新申请重置邮件，并在同一浏览器打开。</InlineError>}
        {phase === "unconfirmed" && <InlineError>密码已修改，退出设备未确认。请返回登录页重新登录。</InlineError>}
        {phase === "ready" && <form className="stack" onSubmit={submit} noValidate>
          <label className="field"><span className="field-label">新密码（{PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} 个字符）</span>
            <PasswordInput id="reset-password" value={password} onChange={setPassword} label="新密码" placeholder="新密码" autoComplete="new-password" disabled={busy} /></label>
          <label className="field"><span className="field-label">确认新密码</span>
            <PasswordInput id="reset-confirm" value={again} onChange={setAgain} label="确认新密码" placeholder="再输入一次" autoComplete="new-password" disabled={busy} /></label>
          {factor && <label className="field"><span className="field-label">验证器 6 位验证码</span>
            <input id="reset-mfa" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} /></label>}
          <InlineError>{error}</InlineError>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "处理中…" : "设置新密码"}</button>
          <p className="field-hint">设置后所有设备都会退出，请用新密码重新登录。</p>
        </form>}
        {phase !== "ready" && phase !== "checking" && <Link href="/account" className="btn btn-secondary btn-block">返回登录</Link>}
      </div>
    </main>
  );
}
