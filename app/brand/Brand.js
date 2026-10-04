"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useCompanyScope from "../use-company-scope";
import { createClient } from "../../lib/supabase/client";
import { readBrand, saveBrand } from "../../lib/supabase/workspace";
import { prepareUploadImage } from "../images";
import { NavLink, PageHeader, Panel } from "../ui";

function Editor({ context }) {
  const [previous, setPrevious] = useState(null), [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const sequence = useRef(0), pending = useRef(false);
  async function reload() {
    if (pending.current || (dirty && !window.confirm("重新读取将放弃未保存的品牌修改，继续吗？"))) return;
    const version = ++sequence.current; pending.current = true; setBusy(true); setError("");
    try {
      const brand = await readBrand(createClient(), context.companyId);
      if (version !== sequence.current) return;
      setPrevious(brand); setDraft(brand); setDirty(false); setMessage("");
    } catch (err) { if (version === sequence.current) setError(err.message); }
    finally { if (version === sequence.current) { pending.current = false; setBusy(false); } }
  }
  useEffect(() => { void reload(); return () => { ++sequence.current; }; }, []);
  useEffect(() => {
    const leave = e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ""; } };
    const link = e => { if ((dirty || busy) && e.target.closest?.("a[href]") && (busy || !window.confirm("品牌修改尚未保存，确认离开？"))) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener("beforeunload", leave); document.addEventListener("click", link, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", link, true); };
  }, [dirty, busy]);
  function edit(value) { setDraft(prev => ({ ...prev, ...value })); setDirty(true); setMessage(""); }
  async function upload(file) {
    if (!file || pending.current) return;
    pending.current = true; setBusy(true); const version = sequence.current;
    try {
      if (file.size > 1048576) throw new Error("公司 Logo 请使用不超过 1MB 的图片。");
      const logo = await prepareUploadImage(file);
      if (version === sequence.current) edit({ logo, logoError: "", removeLogo: false });
    } catch (err) { if (version === sequence.current) setError(err.message); }
    finally { if (version === sequence.current) { pending.current = false; setBusy(false); } }
  }
  async function submit(e) {
    e.preventDefault(); if (pending.current || !draft) return;
    pending.current = true; setBusy(true); setError(""); const version = sequence.current;
    try {
      const brand = await saveBrand(createClient(), previous, draft);
      if (version !== sequence.current) return;
      setPrevious(brand); setDraft(brand); setDirty(false); setMessage("公司品牌已保存到云端。新报价与新生成产品卡片使用此品牌；历史报价保留原快照。");
    } catch (err) { if (version === sequence.current) setError(err.message); }
    finally { if (version === sequence.current) { pending.current = false; setBusy(false); } }
  }
  return <>
    <PageHeader title="公司品牌" subtitle={context.name} />
    <NavLink href={`/cloud?company=${context.companyId}`}>← 公司产品目录</NavLink>
    <p className="fieldHint">只有管理员可以修改。</p>
    {error && <p className="accountError" role="alert">{error}</p>}
    <p role="status">{dirty ? "有未保存修改，未写入浏览器储存。" : message}</p>
    <button disabled={busy} onClick={reload}>重新读取公司品牌</button>
    {draft && <Panel><form onSubmit={submit}><fieldset disabled={busy}>
      <label>公司名称<input required maxLength={120} value={draft.name} onChange={e => edit({ name: e.target.value })} /></label>
      <label>公司联系方式<input maxLength={180} value={draft.contact} onChange={e => edit({ contact: e.target.value })} /></label>
      <label>公司 Logo<input aria-label="公司 Logo" type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void upload(file); }} /><small>不超过 1MB，自动选择手机兼容格式。</small></label>
      {draft.logoError && <p role="alert">{draft.logoError}</p>}
      {draft.logo && <img className="preview" src={draft.logo} alt="公司 Logo" />}
      {(draft.logo || draft.logo_path) && <button type="button" onClick={() => edit({ logo: "", logo_path: null, logoError: "", removeLogo: true })}>移除 Logo</button>}
      <button type="submit">{busy ? "正在保存…" : "保存公司品牌"}</button>
    </fieldset></form></Panel>}
  </>;
}
export default function Brand() {
  const { context, error } = useCompanyScope(true);
  return <main className="page accountPage">{error && <p role="alert">{error}</p>}{context ? <Editor key={`${context.userId}:${context.companyId}`} context={context} /> : <p>正在确认公司管理员权限… <Link href="/account">公司账号</Link></p>}</main>;
}
