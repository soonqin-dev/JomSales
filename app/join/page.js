"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { captureInvite, INVITE_KEY, teamError } from "../../lib/supabase/invitations";

export default function JoinPage() {
  const [user, setUser] = useState(null);
  const [invite, setInvite] = useState(null);
  const [joined, setJoined] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const token = useRef(null);
  const identity = useRef(null);
  const generation = useRef(0);
  const working = useRef(false);

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
      const result = await client.rpc("get_employee_invite", { invite_token: token.current });
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
        if (!session || changed) {
          ++generation.current; identity.current = session?.user.id || null;
          setUser(session?.user || null); setInvite(null); setJoined(null); setError("");
        }
        if (event === "INITIAL_SESSION" || event === "SIGNED_OUT" || (event === "SIGNED_IN" && changed)) {
          clearTimeout(timer); timer = setTimeout(() => void load(), 0);
        }
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

  return <main className="page accountPage">
    <Link href="/account">← 公司账号</Link>
    <h1>加入公司</h1>
    <p className="notice">邀请只授予指定公司的销售员权限，不会搬迁、上传或删除你浏览器里的本地产品和报价。</p>
    {loading && <p role="status">正在检查邀请…</p>}
    {error && <p className="accountError" role="alert">{error}</p>}
    {!loading && !user && !error && <section className="accountCard">
      <h2>请先登录受邀邮箱</h2>
      <p>没有账号？使用管理员指定的邮箱注册并验证，再回到这里接受邀请。员工无需创建公司。</p>
      <p><Link href="/account">注册／登录员工账号 →</Link></p>
      <p>如果验证邮件在另一浏览器或标签页打开，请验证后重新打开原始邀请链接。</p>
    </section>}
    {user && !joined && <p>当前账号：{user.email}。<Link href="/account">需要换账号？前往退出并重新登录</Link></p>}
    {!loading && invite && <section className="accountCard">
      <h2>{invite.company_name}</h2><p>受邀邮箱：{invite.email}</p><p>角色：销售员（可查阅公司产品）</p>
      <p>{invite.already_accepted ? "你曾接受此邀请，将重新确认当前权限。" : `到期：${new Date(invite.expires_at).toLocaleString()}`}</p>
      <button disabled={busy} onClick={() => void accept()}>{busy ? "正在加入…" : invite.already_accepted ? "确认公司访问权限" : "接受邀请并加入公司"}</button>
    </section>}
    {joined && <section className="accountCard" role="status"><h2>已加入公司</h2>
      <p>你已获得销售员权限，管理员维护的产品可在公司云端查阅。</p>
      <Link href={`/cloud?company=${joined}`}>进入公司云端产品 →</Link>
    </section>}
    {!loading && !joined && token.current && <button disabled={busy} onClick={() => void load()}>重新检查邀请</button>}
  </main>;
}
