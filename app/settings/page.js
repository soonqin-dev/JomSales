"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { profileFields, validatePassword,companyReturn,completeCompanyProfile,PASSWORD_MIN_LENGTH,PASSWORD_MAX_LENGTH } from "../../lib/account-utils";

export default function Settings() {
  const [user, setUser] = useState(null), [profile, setProfile] = useState(null);
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const [current, setCurrent] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState(""), [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [factor, setFactor] = useState(null), [enrollment, setEnrollment] = useState(null), [code, setCode] = useState("");
  const [returnTo,setReturnTo]=useState(''),[companyMember,setCompanyMember]=useState(false);
  const profileDirty=!!profile&&(name!==profile.display_name||phone!==profile.whatsapp);
  const phoneChanged=!!profile?.whatsapp&&phone.replace(/[\s()-]/g,'')!==profile.whatsapp;
  const working = useRef(false), identity = useRef(null), sequence = useRef(0),intentionalExit=useRef(false);
  async function load() {
    const version = ++sequence.current;
    setLoading(true); setError("");
    try {
      const client = createClient(), auth = await client.auth.getUser();
      if (auth.error || !auth.data.user) { window.location.replace("/account"); return; }
      if (identity.current && identity.current !== auth.data.user.id) { window.location.replace("/account"); return; }
      identity.current = auth.data.user.id;
      const result = await client.from("account_profiles").select("display_name,whatsapp,revision").eq("user_id", identity.current).maybeSingle();
      if (result.error) throw result.error;
      const [factors,memberships]=await Promise.all([client.auth.mfa.listFactors(),client.from('company_members').select('company_id').eq('user_id',identity.current).eq('active',true)]);
      if(memberships.error)throw memberships.error;
      if (version !== sequence.current) return;
      const row = result.data || { display_name: auth.data.user.user_metadata?.display_name || "", whatsapp: "", revision: 1 };
      setUser(auth.data.user); setProfile(row); setName(row.display_name); setPhone(row.whatsapp);
      setFactor(factors.data?.totp?.[0] || null);
      setCompanyMember(!!memberships.data?.length);setReturnTo(companyReturn(new URLSearchParams(window.location.search).get('next')));
    } catch (err) { if (version === sequence.current) setError(err.message); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    void load();
    const subscription = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (identity.current && session?.user.id !== identity.current)) {
        intentionalExit.current=true;
        ++sequence.current; setUser(null); setCurrent(""); setPassword(""); setConfirm(""); window.location.replace("/account");
      }
    }).data.subscription;
    return () => { ++sequence.current; subscription.unsubscribe(); };
  }, []);
  useEffect(()=>{
    const leave=e=>{if(!intentionalExit.current&&(profileDirty||busy)){e.preventDefault();e.returnValue='';}};
    const link=e=>{const a=e.target.closest?.('a[href]');if(!a||a.hasAttribute('download')||a.target==='_blank'||(!profileDirty&&!busy))return;
      if(busy||!window.confirm('姓名或工作号码尚未保存，离开会放弃修改。继续？')){e.preventDefault();e.stopPropagation();}};
    window.addEventListener('beforeunload',leave);document.addEventListener('click',link,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('click',link,true);};
  },[profileDirty,busy]);
  async function run(task) {
    if (working.current || loading || !user) return;
    working.current = true; setBusy(true); setMessage(""); setError("");
    try { await task(createClient()); }
    catch (err) { setError(err.message || "操作失败，请重试。"); }
    finally { working.current = false; setBusy(false); }
  }
  async function reauthenticate(client) {
    if(profileDirty&&!window.confirm('姓名或工作号码尚未保存。继续修改账号安全设置可能需要退出登录，确认继续？'))throw new Error('已取消，请先保存个人资料。');
    if (!current) throw new Error("请填写当前密码以确认身份。");
    const result = await client.auth.signInWithPassword({ email: user.email, password: current });
    if (result.error) throw result.error;
    if (result.data.user?.id !== identity.current) throw new Error("账号已改变，请重新登录。");
    if (factor) {
      if (!/^[0-9]{6}$/.test(code)) throw new Error("此账号已启用双重验证，请在下方填写验证器验证码，再提交密码／邮箱更改。");
      const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (verified.error) throw verified.error;
      setCode("");
    }
  }
  return <main className="page accountPage">
    <Link href="/account">← 账号</Link><h1>个人设置</h1>
    {returnTo&&<p>进入公司前请补齐姓名和工作 WhatsApp。只需设置一次，之后可直接使用。</p>}
    {loading && <p role="status">正在读取…</p>}{error && <p role="alert" className="accountError">{error}</p>}{message && <p role="status">{message}</p>}
    {!loading && !profile && <button onClick={load}>重新读取</button>}
    {user && profile && <>
      <section className="accountCard"><h2>姓名与工作号码</h2><form onSubmit={e => { e.preventDefault(); void run(async client => {
        const fields = profileFields(name, phone);
        if((companyMember||returnTo)&&!fields.whatsapp)throw new Error('公司成员请填写含国家区号的工作 WhatsApp。');
        const changingPhone=!!profile.whatsapp&&fields.whatsapp!==profile.whatsapp;
        if(changingPhone&&!window.confirm('更改工作 WhatsApp 会永久撤销你在所有公司的旧顾客目录链接；改回旧号码也不会恢复。确认更改？'))return;
        const result = await client.rpc("save_account_profile", { profile_name: fields.displayName, work_whatsapp: fields.whatsapp, expected_revision: profile.revision });
        if (result.error) throw result.error;
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!row) throw new Error("保存结果未确认，请重新读取核对；输入内容已保留。");
        setProfile(row); setName(row.display_name); setPhone(row.whatsapp); setMessage(changingPhone?'个人资料已保存。旧顾客目录链接已撤销，请重新生成；历史报价姓名不变。':"个人资料已保存，历史报价姓名不会改变。");
      }); }}>
        <label htmlFor="profile-name">显示姓名</label><input id="profile-name" required maxLength={120} autoComplete="name" value={name} disabled={busy} onChange={e => setName(e.target.value)} />
        <label htmlFor="profile-phone">工作 WhatsApp（含国家区号）</label><input id="profile-phone" type="tel" required={companyMember||!!returnTo} autoComplete="tel" placeholder="+60123456789" maxLength={30} value={phone} disabled={busy} onChange={e => setPhone(e.target.value)} />
        {phoneChanged&&<p>保存新号码后，旧顾客目录分享链接会永久失效，需要重新生成。</p>}
        <button disabled={busy}>保存个人资料</button>
      </form><button disabled={busy} onClick={() => { if (window.confirm("重新读取将替换尚未保存的姓名和号码，继续？")) void load(); }}>重新读取</button></section>
      {returnTo&&completeCompanyProfile(profile)&&<p><Link href={returnTo}>继续进入公司</Link></p>}
      <section className="accountCard"><h2>账号安全</h2>
        <label htmlFor="current-password">当前密码（修改密码／邮箱前填写）</label><input id="current-password" type="password" autoComplete="current-password" value={current} disabled={busy} onChange={e => setCurrent(e.target.value)} />
        <form onSubmit={e => { e.preventDefault(); void run(async client => {
          validatePassword(password, confirm); await reauthenticate(client);
          const result = await client.auth.updateUser({ password, current_password: current });
          if (result.error) throw result.error;
          const signout = await client.auth.signOut({ scope: "global" });
          setCurrent(""); setPassword(""); setConfirm("");
          if (signout.error) setMessage("密码已修改，但退出全部设备未确认；请重新登录并检查其他设备。");
          else {intentionalExit.current=true;window.location.replace("/account");}
        }); }}>
          <label htmlFor="new-password">新密码（{PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} 个字符）</label><input id="new-password" type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
          <label htmlFor="confirm-password">确认新密码</label><input id="confirm-password" type="password" required autoComplete="new-password" value={confirm} disabled={busy} onChange={e => setConfirm(e.target.value)} />
          <button disabled={busy}>修改密码并退出登录</button>
        </form>
        <p>当前邮箱：{user.email}</p>{user.new_email && <p>待验证邮箱：{user.new_email}</p>}
        <form onSubmit={e => { e.preventDefault(); void run(async client => {
          if (email.trim().toLowerCase() === user.email.toLowerCase()) throw new Error("请输入不同的新邮箱。");
          await reauthenticate(client);
          const result = await client.auth.updateUser({ email: email.trim() }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=settings` });
          if (result.error) throw result.error;
          setCurrent(""); setUser(result.data.user); setMessage("邮箱更改申请已提交。请完成邮件要求的验证；账号归属不变。");
        }); }}>
          <label htmlFor="new-email">新登录邮箱</label><input id="new-email" type="email" required maxLength={254} autoComplete="email" value={email} disabled={busy} onChange={e => setEmail(e.target.value)} />
          <button disabled={busy}>验证并更改邮箱</button>
        </form>
      </section>
      <details className="accountCard"><summary>双重验证</summary>
        {!factor && !enrollment && <button disabled={busy} onClick={() => void run(async client => {
          const result = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "JomSales" });
          if (result.error) throw result.error; setEnrollment(result.data);
        })}>设置验证器</button>}
        {enrollment && <><img src={enrollment.totp.qr_code} alt="验证器设置二维码" width={180} height={180} /><p>手动密钥：{enrollment.totp.secret}</p></>}
        {(factor || enrollment) && <form onSubmit={e => { e.preventDefault(); void run(async client => {
          const factorId=enrollment?.id || factor.id;
          const result = await client.auth.mfa.challengeAndVerify({ factorId, code });
          if (result.error) throw result.error;
          setCode(""); setEnrollment(null);setFactor(previous=>({...previous,id:factorId}));setMessage("双重验证已通过。可以进入平台后台。");
        }); }}><label htmlFor="mfa-code">验证器六位验证码</label><input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={e => setCode(e.target.value)} /><button disabled={busy}>验证</button></form>}
      </details>
    </>}
  </main>;
}
