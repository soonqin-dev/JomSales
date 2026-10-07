"use client";
// AUTH.LOGIN / AUTH.REGISTER (4 steps) / AUTH.VERIFY / AUTH.WAIT — docs/auth-spec.md, Figma docs/figma/AUTH.png.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { pendingInvite } from "../../lib/supabase/invitations";
import { completeCompanyProfile, normalizeMalaysiaPhone, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../lib/account-utils";
import { companyProfileSetupUrl } from "../../lib/supabase/company-profile";
import { InlineError, PasswordInput, SkeletonList, useToast } from "../ui";
import Icon from "../icons";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => { if (!left) return; const timer = setTimeout(() => setLeft(n => n - 1), 1000); return () => clearTimeout(timer); }, [left]);
  return [left, () => setLeft(60)];
}

// Supabase errors are never shown raw; account existence is never revealed.
function loginError(error) {
  const code = error?.code || "", message = error?.message || "", status = error?.status;
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) return { kind: "unconfirmed", text: "这个邮箱还没有验证。请先点开验证邮件里的链接。" };
  if (status === 429 || /rate limit|too many/i.test(code + message)) return { kind: "rate", text: "尝试次数过多，请稍后再试。" };
  if (error instanceof TypeError || /fetch|network/i.test(message)) return { kind: "network", text: "无法连接，请检查网络后重试。" };
  if (code === "invalid_credentials" || status === 400) return { kind: "credentials", text: "邮箱或密码不正确。" };
  return { kind: "other", text: "登录未完成，请稍后重试。" };
}
const requestError = error => (error?.status === 429 || /rate limit/i.test(error?.message || "")) ? "尝试次数过多，请稍后再试。" : "暂时无法发送，请检查网络后重试。";

export default function AccountPage() {
  const [state, setState] = useState({ phase: "loading" });
  const [view, setView] = useState("login");
  const [invite, setInvite] = useState(false);
  const [flash, setFlash] = useState("");
  // Registration answers live in page memory only; the password is cleared after submit.
  const [reg, setReg] = useState({ name: "", phone: "", email: "", password: "", submittedEmail: "" });
  const sequence = useRef(0);

  async function route() {
    const version = ++sequence.current;
    try {
      const client = createClient();
      const { data, error } = await client.auth.getUser();
      if (version !== sequence.current) return;
      if (error && error.name !== "AuthSessionMissingError" && ![401, 403].includes(error.status)) throw error;
      if (!data?.user) { setState({ phase: "guest" }); return; }
      const user = data.user;
      // §2: invitation first, then company read (a failed read never shows AUTH.WAIT).
      if (pendingInvite()) { window.location.replace("/join"); return; }
      const [members, profile, past] = await Promise.all([
        // companies(id) is null when the company is suspended/expired (RLS hides it).
        client.from("company_members").select("company_id,companies(id)").eq("user_id", user.id).eq("active", true),
        client.from("account_profiles").select("display_name,whatsapp").eq("user_id", user.id).maybeSingle(),
        client.from("company_members").select("company_id").eq("user_id", user.id).limit(1)
      ]);
      if (members.error) throw members.error;
      if (version !== sequence.current) return;
      if (!members.data?.length) { setState({ phase: "wait", user, formerMember: !past.error && !!past.data?.length }); return; }
      // Membership exists but every company is suspended or expired: never loop into /cloud.
      const usable = members.data.filter(m => m.companies);
      if (!usable.length) { setState({ phase: "wait", user, suspended: true }); return; }
      if (!profile.error && !completeCompanyProfile(profile.data)) { window.location.replace(companyProfileSetupUrl(usable[0].company_id, "/cloud")); return; }
      window.location.replace("/cloud");
    } catch (err) {
      if (version === sequence.current) setState(prev => ({ ...prev, phase: prev.phase === "loading" ? "error" : prev.phase, error: `无法读取账号资料：${err.message}` }));
    }
  }

  useEffect(() => {
    try { setInvite(!!pendingInvite()); } catch { /* blocked storage: invitation banner just stays hidden */ }
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "1") { setFlash("密码已更新，请用新密码登录。"); window.history.replaceState(null, "", "/account"); }
    void route();
    return () => { ++sequence.current; };
  }, []);

  if (state.phase === "loading") return <main className="auth-main"><div className="auth-logo">JOM<br />SALES</div><SkeletonList count={3} height={48} /></main>;
  if (state.phase === "error") return <main className="auth-main"><div className="auth-logo">JOM<br />SALES</div>
    <InlineError onRetry={() => { setState({ phase: "loading" }); void route(); }} retryLabel="重新读取">{state.error}</InlineError></main>;
  if (state.phase === "wait") return <WaitView state={state} onReload={() => { setState({ phase: "loading" }); void route(); }} />;

  if (view === "verify") return <VerifyView key={reg.resent ? "again" : "first"} email={reg.submittedEmail} resent={reg.resent} onBack={() => setView("register-4")} onLogin={() => setView("login")} />;
  if (view.startsWith("register")) return <RegisterView step={Number(view.split("-")[1] || 1)} reg={reg} setReg={setReg} go={setView} invite={invite} />;
  return <LoginView invite={invite} flash={flash} onRegister={() => setView("register-1")} onSignedIn={() => { setState({ phase: "loading" }); void route(); }} />;
}

function LoginView({ invite, flash, onRegister, onSignedIn }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [emailError, setEmailError] = useState(""), [notice, setNotice] = useState(flash);
  const [forgotLeft, startForgot] = useCountdown(), [resendLeft, startResend] = useCountdown();
  const emailInput = useRef(null);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) { setError({ kind: "credentials", text: "请输入邮箱和密码。" }); return; }
    setBusy(true); setError(null); setNotice("");
    try {
      const result = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      setPassword("");
      if (pendingInvite()) { window.location.replace("/join"); return; }
      onSignedIn();
    } catch (err) { setError(loginError(err)); setBusy(false); }
  }
  async function forgot() {
    if (forgotLeft) return;
    if (!email.trim()) { setEmailError("请先在上面输入邮箱。"); emailInput.current?.focus(); return; }
    setEmailError(""); setError(null);
    try {
      const result = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/reset` });
      if (result.error) throw result.error;
      setNotice("如果这个邮箱已注册，你会收到一封重置邮件。请在这台手机的同一个浏览器里打开链接。"); startForgot();
    } catch (err) { setError({ kind: "other", text: requestError(err) }); }
  }
  async function resend() {
    if (resendLeft) return;
    try {
      const result = await createClient().auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (result.error) throw result.error;
      setNotice("验证邮件已重新发送，请稍候查看。"); startResend();
    } catch (err) { setError({ kind: "other", text: requestError(err) }); }
  }

  return (
    <main className="auth-main">
      {invite && <div className="notice-box" style={{ marginBottom: -24 }}>你正在接受公司邀请，请用受邀邮箱登录或注册。 <Link href="/join" className="text-btn">返回邀请</Link></div>}
      <div className="auth-logo" aria-label="JomSales">JOM<br />SALES</div>
      <form className="stack-sm" onSubmit={submit} noValidate>
        {error && <InlineError>{error.text}{error.kind === "unconfirmed" && <> <button type="button" className="text-btn" disabled={!!resendLeft} onClick={resend}>{resendLeft ? `${resendLeft} 秒后可重发` : "重新发送验证邮件"}</button></>}</InlineError>}
        {notice && <div className="notice-box" role="status">{notice}</div>}
        <input id="account-email" ref={emailInput} className="input" type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="example@gmail.com" aria-label="邮箱"
          aria-invalid={!!emailError} value={email} disabled={busy} onChange={e => { setEmail(e.target.value); setEmailError(""); }} />
        {emailError && <span className="field-error">{emailError}</span>}
        <PasswordInput id="account-password" value={password} onChange={setPassword} label="密码" maxLength={PASSWORD_MAX_LENGTH} disabled={busy} />
        <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 8 }} disabled={busy}>{busy ? "处理中…" : "登录"}</button>
        <button type="button" className="text-btn" style={{ justifySelf: "center" }} disabled={!!forgotLeft} onClick={forgot}>{forgotLeft ? `${forgotLeft} 秒后可再次发送` : "忘记密码？"}</button>
      </form>
      <div style={{ marginTop: "auto", paddingTop: 48 }} className="stack-sm">
        <button type="button" className="btn btn-secondary btn-block" onClick={onRegister}>注册员工账号</button>
        <p className="small muted" style={{ textAlign: "center" }}>收到邀请的员工，请用邀请链接加入。</p>
      </div>
    </main>
  );
}

const STEPS = {
  1: { title: "你的姓名", sub: "请输入你工作中的名字。" },
  2: { title: "你的WhatsApp号", sub: "请输入你工作中使用的WhatsApp号码。" },
  3: { title: "你的邮箱", sub: "请输入你工作中使用的邮箱。" },
  4: { title: "你的密码", sub: `请创建至少包含 ${PASSWORD_MIN_LENGTH} 个字符的密码。` }
};

function StepHeader({ onBack, step }) {
  return (
    <div className="auth-step-head">
      <button type="button" className="circle-btn" aria-label="返回" onClick={onBack}><Icon name="arrowLeft" size={20} strokeWidth={2.25} /></button>
      {step && <span className="small muted" style={{ marginLeft: "auto" }}>{step} / 4</span>}
    </div>
  );
}

function RegisterView({ step, reg, setReg, go, invite }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = (key, value) => { setReg(prev => ({ ...prev, [key]: value })); setError(""); };
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); setError(""); }, [step]);

  async function next(event) {
    event.preventDefault();
    if (step === 1) {
      const name = reg.name.trim();
      if (!name || name.length > 120) { setError("请输入 1–120 个字符的姓名。"); return; }
      go("register-2");
    } else if (step === 2) {
      try { if (!normalizeMalaysiaPhone(reg.phone)) throw new Error("请输入正确的手机号码，例如 12 345 6789。"); go("register-3"); }
      catch (err) { setError(err.message); }
    } else if (step === 3) {
      if (!EMAIL.test(reg.email.trim()) || reg.email.trim().length > 254) { setError("请输入有效的邮箱。"); return; }
      go("register-4");
    } else await submit();
  }

  async function submit() {
    if (busy) return;
    if (reg.password.length < PASSWORD_MIN_LENGTH) { setError(`密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符。`); return; }
    if (reg.password.length > PASSWORD_MAX_LENGTH) { setError(`密码最多 ${PASSWORD_MAX_LENGTH} 个字符。`); return; }
    const email = reg.email.trim();
    // Back from AUTH.VERIFY with the same email: never call signUp twice.
    if (reg.submittedEmail && reg.submittedEmail.toLowerCase() === email.toLowerCase()) {
      setReg(prev => ({ ...prev, password: "", resent: true })); go("verify"); return;
    }
    let whatsapp, name = reg.name.trim();
    try { whatsapp = normalizeMalaysiaPhone(reg.phone); } catch (err) { setError(err.message); go("register-2"); return; }
    if (!name || name.length > 120) { go("register-1"); return; }
    setBusy(true); setError("");
    try {
      const result = await createClient().auth.signUp({ email, password: reg.password, options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`, data: { display_name: name, whatsapp } } });
      if (result.error) throw result.error;
      setReg(prev => ({ ...prev, password: "", submittedEmail: email, resent: false }));
      if (result.data.session) { console.warn("Email confirmation appears disabled in Supabase Auth."); window.location.replace(pendingInvite() ? "/join" : "/account"); return; }
      go("verify");
    } catch (err) {
      setReg(prev => ({ ...prev, password: "" }));
      setError(/password/i.test(err.message || "") ? `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符。` : (err.status === 429 ? "尝试次数过多，请稍后再试。" : "注册未完成，请检查网络后重试。"));
    } finally { setBusy(false); }
  }

  const copy = STEPS[step];
  return (
    <main className="auth-main">
      <StepHeader step={step} onBack={() => go(step === 1 ? "login" : `register-${step - 1}`)} />
      <form className="stack" onSubmit={next} noValidate>
        <div><h1 className="auth-title">{copy.title}</h1><p className="auth-sub">{copy.sub}</p></div>
        {invite && step === 1 && <div className="notice-box">请使用收到邀请的邮箱注册。注册时不能创建公司。</div>}
        {step === 1 && <input ref={input} className="input" autoComplete="name" maxLength={120} placeholder="名字" aria-label="姓名" aria-invalid={!!error} value={reg.name} onChange={e => set("name", e.target.value)} />}
        {step === 2 && <><div className="input-group" aria-invalid={!!error}><span className="prefix">+60</span>
          <input ref={input} className="input" type="tel" inputMode="tel" autoComplete="tel-national" maxLength={20} placeholder="12 345 6789" aria-label="WhatsApp 号码" value={reg.phone} onChange={e => set("phone", e.target.value)} /></div>
          <span className="field-hint">顾客通过你分享的链接联系你时会用到这个号码。之后可在「我的」里更改。</span></>}
        {step === 3 && <input ref={input} className="input" type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="example@gmail.com" aria-label="邮箱" aria-invalid={!!error} value={reg.email} onChange={e => set("email", e.target.value)} />}
        {step === 4 && <><PasswordInput value={reg.password} onChange={value => set("password", value)} autoComplete="new-password" label="密码" invalid={!!error} disabled={busy} />
          <span className="field-hint">建议使用更长、且不与其他网站重复的密码。</span></>}
        {error && <span className="field-error" role="alert">{error}</span>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{step === 4 ? (busy ? "处理中…" : "注册并验证邮箱") : "下一步"}</button>
      </form>
    </main>
  );
}

function VerifyView({ email, resent, onBack, onLogin }) {
  const [left, start] = useCountdown(), [error, setError] = useState("");
  const [notice, setNotice] = useState(resent ? "验证邮件已经发送，请检查邮箱，或点击重新发送。" : "");
  async function resend() {
    if (left) return;
    setError("");
    try {
      const result = await createClient().auth.resend({ type: "signup", email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (result.error) throw result.error;
      setNotice("验证邮件已重新发送，请稍候查看。"); start();
    } catch (err) { setError(requestError(err)); }
  }
  return (
    <main className="auth-main">
      <StepHeader onBack={onBack} />
      <div className="stack">
        <div><h1 className="auth-title">验证邮箱</h1>
          <p className="auth-sub">注册申请已提交。请检查 <strong>{email}</strong> 的收件箱，包括垃圾邮件，验证后回来登录。</p>
          <p className="auth-sub">如果这个邮箱之前已经注册过，请直接登录。</p></div>
        {notice && <div className="notice-box" role="status">{notice}</div>}
        <InlineError>{error}</InlineError>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={onLogin}>返回登录页面</button>
          <button type="button" className="btn btn-primary" disabled={!!left} onClick={resend}>{left ? `${left} 秒后可重发` : "重新发送邮件"}</button>
        </div>
      </div>
    </main>
  );
}

function WaitView({ state, onReload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { const result = await createClient().auth.signOut({ scope: "local" }); if (result.error) throw result.error; window.location.replace("/account"); }
    catch (err) { toast(`退出失败：${err.message}`); setBusy(false); }
  }
  return (
    <main className="auth-main">
      <div className="auth-logo" style={{ margin: "40px auto 32px" }}>JOM<br />SALES</div>
      <div className="stack">
        <div className="card row"><Icon name="userCircle" size={28} /><span className="grow ellipsis">{state.user.email}</span></div>
        <div><h1 className="auth-title">{state.suspended ? "公司暂时无法使用" : "等待公司邀请"}</h1>
          <p className="auth-sub">{state.suspended ? "你所在的公司目前已停用或服务已到期，资料都还保留。请联系 JomSales 负责人重新开通。"
            : state.formerMember ? "你对原来公司的访问已停用。如有疑问，请联系公司管理员。" : "你的账号已创建。请让公司管理员给你发送邀请链接，打开链接即可加入公司。"}</p></div>
        <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={onReload}><Icon name="refresh" size={18} />重新读取</button>
        <Link href="/settings" className="btn btn-secondary btn-block">个人资料</Link>
        <button type="button" className="btn btn-danger btn-block" disabled={busy} onClick={logout}>退出登录</button>
        {/* Platform owners must always reach /platform, even with no usable company. */}
        <Link href="/platform" className="text-btn" style={{ justifySelf: "center" }}><Icon name="shield" size={16} />平台管理</Link>
      </div>
    </main>
  );
}
