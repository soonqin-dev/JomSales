"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { pendingInvite } from "../../../lib/supabase/invitations";

export default function AuthCallback() {
  const [message, setMessage] = useState("正在确认邮箱验证结果…");
  useEffect(() => {
    let cancelled = false;
    async function finish() {
      try {
        const url = new URL(window.location.href);
        const failure = url.searchParams.get("error") || new URLSearchParams(url.hash.slice(1)).get("error");
        const next = url.searchParams.get("next");
        // The browser client automatically exchanges the PKCE code on initialization.
        const { data, error } = await createClient().auth.getUser();
        window.history.replaceState(null, "", "/auth/callback");
        if (cancelled) return;
        if (failure) setMessage("验证链接无效或已过期。请返回账号页重新发送验证邮件。");
        else if (data.user && !error) window.location.replace(next === "settings" ? "/settings" : pendingInvite() ? "/join" : "/account");
        else setMessage("请返回账号页尝试登录。若邮箱尚未验证，请重新发送邮件，并在注册时使用的同一浏览器打开链接。");
      } catch {
        if (!cancelled) setMessage("暂时无法确认验证结果，请返回账号页尝试登录或重新发送验证邮件。");
      }
    }
    void finish();
    return () => { cancelled = true; };
  }, []);
  return <main className="page accountPage"><h1>邮箱验证</h1>
    <p role="status">{message}</p><Link href="/account">返回账号页</Link>
  </main>;
}
