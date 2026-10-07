"use client";
// PRO｜个人资料 + SEC｜账号安全 — docs/pages-spec.md §4. Used by /me/profile, /me/security
// and /settings (AUTH.PROFILE_FIRST setup for older accounts without a WhatsApp number).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { companyReturn, completeCompanyProfile, malaysiaLocalPart, normalizeMalaysiaPhone, profileFields, validatePassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../lib/account-utils";
import { InlineError, PasswordInput, SkeletonList, useConfirm, useToast } from "./ui";
import Icon from "./icons";

function useAccount() {
  const [state, setState] = useState({ loading: true, error: "", user: null, profile: null, factor: null, member: false });
  const identity = useRef(null), sequence = useRef(0);
  async function load() {
    const version = ++sequence.current;
    setState(prev => ({ ...prev, loading: true, error: "" }));
    try {
      const client = createClient(), auth = await client.auth.getUser();
      if (auth.error || !auth.data.user || (identity.current && identity.current !== auth.data.user.id)) { window.location.replace("/account"); return; }
      identity.current = auth.data.user.id;
      const [profile, factors, memberships] = await Promise.all([
        client.from("account_profiles").select("display_name,whatsapp,revision").eq("user_id", identity.current).maybeSingle(),
        client.auth.mfa.listFactors(),
        client.from("company_members").select("company_id").eq("user_id", identity.current).eq("active", true)
      ]);
      if (profile.error) throw profile.error;
      if (memberships.error) throw memberships.error;
      if (version !== sequence.current) return;
      setState({ loading: false, error: "", user: auth.data.user,
        profile: profile.data || { display_name: auth.data.user.user_metadata?.display_name || "", whatsapp: "", revision: 1 },
        factor: factors.data?.totp?.[0] || null, member: !!memberships.data?.length });
    } catch (err) { if (version === sequence.current) setState(prev => ({ ...prev, loading: false, error: `读取失败：${err.message}` })); }
  }
  useEffect(() => {
    void load();
    const subscription = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (identity.current && session && session.user.id !== identity.current)) { ++sequence.current; window.location.replace("/account"); }
    }).data.subscription;
    return () => { ++sequence.current; subscription.unsubscribe(); };
  }, []);
  return { ...state, reload: load, setState };
}

export function ProfileForm({ setup = false, onSaved }) {
  const account = useAccount(), confirm = useConfirm(), toast = useToast();
  const [name, setName] = useState(""), [local, setLocal] = useState(""), [international, setInternational] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [phoneError, setPhoneError] = useState("");
  const [returnTo, setReturnTo] = useState("");
  const profile = account.profile;

  useEffect(() => {
    if (!profile) return;
    setName(profile.display_name || "");
    const part = malaysiaLocalPart(profile.whatsapp);
    // A saved non-Malaysian number stays as-is; it is not forced into +60.
    if (part === null) { setInternational(profile.whatsapp); setLocal(""); } else { setInternational(null); setLocal(part); }
  }, [profile]);
  useEffect(() => { if (setup) setReturnTo(companyReturn(new URLSearchParams(window.location.search).get("next"))); }, [setup]);

  function phoneValue() {
    if (international !== null) return profileFields(name, international).whatsapp;
    return normalizeMalaysiaPhone(local);
  }
  const dirty = !!profile && (name !== profile.display_name || (() => { try { return phoneValue() !== profile.whatsapp; } catch { return true; } })());

  useEffect(() => {
    const leave = event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, busy]);

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setError(""); setPhoneError("");
    let fields;
    try {
      const whatsapp = phoneValue();
      fields = { ...profileFields(name, ""), whatsapp };
      if ((account.member || setup) && !whatsapp) throw Object.assign(new Error("公司成员请填写工作 WhatsApp。"), { phone: true });
    } catch (err) { if (err.phone || /号码|WhatsApp/.test(err.message)) setPhoneError(err.message); else setError(err.message); return; }
    const changingPhone = !!profile.whatsapp && fields.whatsapp !== profile.whatsapp;
    if (changingPhone && !(await confirm({ title: "更改 WhatsApp 号码？", message: "更改号码会让你之前分享的目录链接永久失效，改回旧号码也不会恢复。", confirmLabel: "确认更改", danger: true }))) return;
    setBusy(true);
    try {
      const result = await createClient().rpc("save_account_profile", { profile_name: fields.displayName, work_whatsapp: fields.whatsapp, expected_revision: profile.revision });
      if (result.error) throw result.error;
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row) throw new Error("保存结果未确认，请重新读取核对；输入内容已保留。");
      account.setState(prev => ({ ...prev, profile: row }));
      toast(changingPhone ? "已保存。旧的目录链接已失效，请重新生成" : "个人资料已保存");
      onSaved?.(row);
    } catch (err) { setError(err.message || "保存失败，请重试。"); }
    finally { setBusy(false); }
  }

  if (account.loading) return <SkeletonList count={3} height={56} />;
  if (!profile) return <InlineError onRetry={account.reload}>{account.error || "资料读取失败"}</InlineError>;

  return (
    <form className="stack" onSubmit={save} noValidate>
      {setup && <div className="notice-box">请先补齐资料再进入公司。只需设置一次。</div>}
      <label className="field"><span className="field-label">姓名*</span>
        <input className="input" maxLength={120} autoComplete="name" value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
      <div className="field"><span className="field-label" id="pro-phone">工作 WhatsApp{account.member || setup ? "*" : ""}</span>
        {international !== null
          ? <><input className="input" type="tel" aria-labelledby="pro-phone" value={international} maxLength={30} disabled={busy} onChange={e => setInternational(e.target.value)} />
            <button type="button" className="text-btn" style={{ justifySelf: "start" }} onClick={() => { setInternational(null); setLocal(""); }}>改用马来西亚号码（+60）</button></>
          : <div className="input-group" aria-invalid={!!phoneError}><span className="prefix">+60</span>
            <input className="input" type="tel" inputMode="tel" autoComplete="tel-national" aria-labelledby="pro-phone" placeholder="12 345 6789" value={local} maxLength={20} disabled={busy}
              onChange={e => { setLocal(e.target.value); setPhoneError(""); }} /></div>}
        {phoneError ? <span className="field-error">{phoneError}</span> : <span className="field-hint">顾客通过你分享的目录联系你时会用到这个号码。</span>}
      </div>
      <InlineError>{error}</InlineError>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !dirty}>{busy ? "保存中…" : "保存资料"}</button>
      {setup && returnTo && completeCompanyProfile(profile) && <Link href={returnTo} className="btn btn-secondary btn-block">继续进入公司</Link>}
    </form>
  );
}

export function SecurityPanel() {
  const account = useAccount(), toast = useToast();
  const [platform, setPlatform] = useState(false);
  useEffect(() => { createClient().rpc("is_platform_admin").then(r => setPlatform(!r.error && r.data === true)).catch(() => {}); }, []);
  if (account.loading) return <SkeletonList count={3} height={56} />;
  if (!account.user) return <InlineError onRetry={account.reload}>{account.error || "账号读取失败"}</InlineError>;
  return (
    <div className="stack">
      {platform && !account.factor && <InlineError>你是平台负责人，请先启用双重验证，才能进入平台后台。</InlineError>}
      <PasswordSection account={account} />
      <EmailSection account={account} />
      <MfaSection account={account} toast={toast} onVerified={async () => {
        // is_platform_admin needs an aal2 session, so it can only be confirmed after verifying.
        try { const r = await createClient().rpc("is_platform_admin"); setPlatform(!r.error && r.data === true); } catch { /* link stays hidden */ }
      }} />
      {platform && account.factor && <Link href="/platform" className="btn btn-primary btn-block"><Icon name="shield" size={18} />进入平台后台</Link>}
    </div>
  );
}

// Password and email changes re-confirm identity (and the authenticator when enabled).
async function reauthenticate(client, account, current, code) {
  if (!current) throw new Error("请填写当前密码以确认身份。");
  const result = await client.auth.signInWithPassword({ email: account.user.email, password: current });
  if (result.error) throw new Error("当前密码不正确。");
  if (result.data.user?.id !== account.user.id) throw new Error("账号已改变，请重新登录。");
  if (account.factor) {
    if (!/^[0-9]{6}$/.test(code)) throw new Error("此账号已启用双重验证，请填写验证器的 6 位验证码。");
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: account.factor.id, code });
    if (verified.error) throw new Error("验证码不正确，请重试。");
  }
}

function CodeField({ value, onChange, disabled }) {
  return <label className="field"><span className="field-label">验证器 6 位验证码</span>
    <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} disabled={disabled} onChange={e => onChange(e.target.value.replace(/\D/g, ""))} /></label>;
}

function PasswordSection({ account }) {
  const [current, setCurrent] = useState(""), [password, setPassword] = useState(""), [again, setAgain] = useState(""), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      validatePassword(password, again);
      const client = createClient();
      await reauthenticate(client, account, current, code);
      const result = await client.auth.updateUser({ password, current_password: current });
      if (result.error) throw result.error;
      setCurrent(""); setPassword(""); setAgain(""); setCode("");
      const signout = await client.auth.signOut({ scope: "global" });
      if (signout.error) setError("密码已修改，但退出全部设备未确认；请重新登录并检查其他设备。");
      else window.location.replace("/account");
    } catch (err) { setError(err.message || "修改失败，请重试。"); }
    finally { setBusy(false); }
  }
  return (
    <details className="card fold"><summary><span className="row"><Icon name="lock" size={20} />密码</span><Icon name="chevronDown" size={18} /></summary>
      <form className="fold-body" onSubmit={submit} noValidate>
        <label className="field"><span className="field-label">当前密码</span><PasswordInput value={current} onChange={setCurrent} label="当前密码" disabled={busy} /></label>
        <label className="field"><span className="field-label">新密码（{PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} 个字符）</span>
          <PasswordInput value={password} onChange={setPassword} label="新密码" placeholder="新密码" autoComplete="new-password" disabled={busy} /></label>
        <label className="field"><span className="field-label">确认新密码</span>
          <PasswordInput value={again} onChange={setAgain} label="确认新密码" placeholder="再输入一次" autoComplete="new-password" disabled={busy} /></label>
        {account.factor && <CodeField value={code} onChange={setCode} disabled={busy} />}
        <InlineError>{error}</InlineError>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "处理中…" : "修改密码并重新登录"}</button>
        <p className="field-hint">修改后所有设备都会退出登录。</p>
      </form>
    </details>
  );
}

function EmailSection({ account }) {
  const toast = useToast();
  const [email, setEmail] = useState(""), [current, setCurrent] = useState(""), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("请输入有效的新邮箱。"); return; }
    if (email.trim().toLowerCase() === account.user.email.toLowerCase()) { setError("请输入不同的新邮箱。"); return; }
    setBusy(true);
    try {
      const client = createClient();
      await reauthenticate(client, account, current, code);
      const result = await client.auth.updateUser({ email: email.trim() }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=settings` });
      if (result.error) throw result.error;
      setCurrent(""); setCode(""); setEmail("");
      account.setState(prev => ({ ...prev, user: result.data.user }));
      toast("验证邮件已发送，请到新邮箱完成验证");
    } catch (err) { setError(err.message || "提交失败，请重试。"); }
    finally { setBusy(false); }
  }
  return (
    <details className="card fold"><summary><span className="row"><Icon name="send" size={20} />邮箱</span><Icon name="chevronDown" size={18} /></summary>
      <form className="fold-body" onSubmit={submit} noValidate>
        <label className="field"><span className="field-label">当前邮箱</span><input className="input" value={account.user.email} readOnly /></label>
        {account.user.new_email && <span className="chip">待验证：{account.user.new_email}</span>}
        <label className="field"><span className="field-label">新邮箱</span>
          <input className="input" type="email" maxLength={254} autoComplete="email" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} /></label>
        <label className="field"><span className="field-label">当前密码</span><PasswordInput value={current} onChange={setCurrent} label="确认邮箱更改的当前密码" disabled={busy} /></label>
        {account.factor && <CodeField value={code} onChange={setCode} disabled={busy} />}
        <InlineError>{error}</InlineError>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "处理中…" : "发送验证邮件"}</button>
      </form>
    </details>
  );
}

function MfaSection({ account, toast, onVerified }) {
  const [enrollment, setEnrollment] = useState(null), [code, setCode] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function enroll() {
    setBusy(true); setError("");
    try { const result = await createClient().auth.mfa.enroll({ factorType: "totp", friendlyName: "JomSales" }); if (result.error) throw result.error; setEnrollment(result.data); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function verify(event) {
    event.preventDefault();
    if (!/^[0-9]{6}$/.test(code)) { setError("请输入 6 位验证码。"); return; }
    setBusy(true); setError("");
    try {
      const factorId = enrollment?.id || account.factor.id;
      const result = await createClient().auth.mfa.challengeAndVerify({ factorId, code });
      if (result.error) throw new Error("验证码不正确，请重试。");
      setCode(""); setEnrollment(null);
      account.setState(prev => ({ ...prev, factor: { ...(prev.factor || {}), id: factorId } }));
      toast("双重验证已通过");
      await onVerified?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function copySecret() {
    try { await navigator.clipboard.writeText(enrollment.totp.secret); toast("密钥已复制"); } catch { toast("请手动选中密钥复制"); }
  }
  return (
    <details className="card fold"><summary><span className="row"><Icon name="shield" size={20} />双重验证
      <span className={`pill ${account.factor ? "pill-green" : "pill-muted"}`}>{account.factor ? "已启用" : "未设置"}</span></span><Icon name="chevronDown" size={18} /></summary>
      <div className="fold-body">
        {!account.factor && !enrollment && <><p className="small muted">用验证器 App（如 Google Authenticator）扫码，每次登录多一道保护。</p>
          <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={enroll}>设置验证器</button></>}
        {enrollment && <div className="stack-sm" style={{ justifyItems: "center" }}>
          <img src={enrollment.totp.qr_code} alt="验证器设置二维码" width={180} height={180} />
          <p className="small muted">无法扫码时，手动输入密钥：</p>
          <div className="row"><code style={{ overflowWrap: "anywhere" }}>{enrollment.totp.secret}</code>
            <button type="button" className="icon-btn" aria-label="复制密钥" onClick={copySecret}><Icon name="copy" size={18} /></button></div>
        </div>}
        {(account.factor || enrollment) && <form className="stack-sm" onSubmit={verify} noValidate>
          <CodeField value={code} onChange={setCode} disabled={busy} />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "验证中…" : "验证"}</button>
        </form>}
        <InlineError>{error}</InlineError>
      </div>
    </details>
  );
}
