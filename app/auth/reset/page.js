"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { validatePassword,PASSWORD_MIN_LENGTH,PASSWORD_MAX_LENGTH } from "../../../lib/account-utils";

export default function ResetPassword() {
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
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
        if (failure || result.error || !result.data.user) throw new Error("链接失效或尚未登录。请重新申请重置邮件，并在同一浏览器打开。");
        const factors = await createClient().auth.mfa.listFactors();
        if (!live) return;
        if (factors.error) throw factors.error;
        setFactor(factors.data?.totp?.[0] || null);
        setReady(true);
      } catch (err) { if (live) setError(err.message); }
    }
    void check(); return () => { live = false; };
  }, []);
  return <main className="page accountPage"><h1>重置密码</h1>
    {error && <p role="alert" className="accountError">{error}</p>}
    {ready && <form className="accountCard" onSubmit={async e => {
      e.preventDefault(); if (working.current) return; working.current = true; setBusy(true); setError("");
      try {
        validatePassword(password, confirm);
        const client = createClient();
        if (factor) {
          const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
          if (verified.error) throw verified.error;
        }
        const result = await client.auth.updateUser({ password });
        if (result.error) throw result.error;
        const logout = await client.auth.signOut({ scope: "global" });
        setReady(false); setPassword(""); setConfirm("");
        if (logout.error) throw new Error("密码已修改，退出设备未确认。请返回账号页重新登录。");
        window.location.replace("/account");
      } catch (err) { setError(err.message); }
      finally { working.current = false; setBusy(false); }
    }}><label htmlFor="reset-password">新密码（{PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} 个字符）</label><input id="reset-password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
      <label htmlFor="reset-confirm">确认新密码</label><input id="reset-confirm" type="password" autoComplete="new-password" required value={confirm} disabled={busy} onChange={e => setConfirm(e.target.value)} />
      {factor && <><label htmlFor="reset-mfa">验证器验证码</label><input id="reset-mfa" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={e => setCode(e.target.value)} /></>}
      <button disabled={busy}>设置密码并退出登录</button>
    </form>}<p><Link href="/account">返回登录</Link></p></main>;
}
