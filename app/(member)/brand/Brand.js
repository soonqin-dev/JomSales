"use client";
// BRD｜公司资料与品牌 + DEF｜报价默认设置 — docs/pages-spec.md §6. Admin only.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { readBrand, saveBrand } from "../../../lib/supabase/workspace";
import { prepareUploadImage } from "../../images";
import { useMember } from "../../member-context";
import { EmptyState, InlineError, MoreMenu, SkeletonList, TopBar, useConfirm, useToast } from "../../ui";
import QuoteDefaults from "./QuoteDefaults";

export default function Brand() {
  const member = useMember(), confirm = useConfirm();
  const [tab, setTab] = useState("brand");
  const dirtyRef = useRef(false);
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "defaults") setTab("defaults"); }, []);

  async function switchTab(next) {
    if (next === tab) return;
    if (dirtyRef.current && !(await confirm({ title: "放弃修改？", message: "这个分区还有没保存的修改。", cancelLabel: "继续编辑", confirmLabel: "放弃", danger: true }))) return;
    dirtyRef.current = false; setTab(next);
    const url = new URL(window.location.href);
    if (next === "defaults") url.searchParams.set("tab", "defaults"); else url.searchParams.delete("tab");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }

  if (member.role !== "admin") return <main className="app-main"><TopBar title="公司资料" back="/me" />
    <EmptyState icon="lock" title="这个页面仅供公司管理员使用" action={<Link href="/cloud" className="btn btn-secondary btn-sm">回到产品目录</Link>} /></main>;

  return (
    <main className="app-main">
      <TopBar title={tab === "brand" ? "公司资料与品牌" : "报价默认设置"} back="/admin" />
      <div className="stack">
        <div className="segmented" role="group" aria-label="分区">
          <button type="button" aria-pressed={tab === "brand"} onClick={() => void switchTab("brand")}>公司品牌</button>
          <button type="button" aria-pressed={tab === "defaults"} onClick={() => void switchTab("defaults")}>报价默认</button>
        </div>
        {tab === "brand" ? <BrandEditor onDirty={value => { dirtyRef.current = value; }} /> : <QuoteDefaults onDirty={value => { dirtyRef.current = value; }} />}
      </div>
    </main>
  );
}

function BrandEditor({ onDirty }) {
  const member = useMember(), confirm = useConfirm(), toast = useToast();
  const [previous, setPrevious] = useState(null), [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState(""), [nameError, setNameError] = useState("");
  const sequence = useRef(0), pending = useRef(false), fileInput = useRef(null);
  useEffect(() => { onDirty(dirty); }, [dirty]);

  async function reload(ask = true) {
    if (pending.current) return;
    if (ask && dirty && !(await confirm({ title: "重新读取？", message: "未保存的品牌修改会被放弃。", confirmLabel: "重新读取", danger: true }))) return;
    const version = ++sequence.current; pending.current = true; setBusy(true); setError("");
    try {
      const brand = await readBrand(createClient(), member.companyId);
      if (version !== sequence.current) return;
      setPrevious(brand); setDraft(brand); setDirty(false);
    } catch (err) { if (version === sequence.current) setError(err.message); }
    finally { if (version === sequence.current) { pending.current = false; setBusy(false); } }
  }
  useEffect(() => { void reload(false); return () => { ++sequence.current; }; }, []);
  useEffect(() => {
    const leave = e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, busy]);

  function edit(value) { setDraft(prev => ({ ...prev, ...value })); setDirty(true); }
  async function upload(file) {
    if (!file || pending.current) return;
    pending.current = true; setBusy(true); setError(""); const version = sequence.current;
    try {
      if (file.size > 1048576) throw new Error("公司 Logo 请使用不超过 1MB 的图片。");
      const logo = await prepareUploadImage(file);
      if (version === sequence.current) edit({ logo, logoError: "", removeLogo: false });
    } catch (err) { if (version === sequence.current) setError(err.message); }
    finally { if (version === sequence.current) { pending.current = false; setBusy(false); } }
  }
  async function submit(e) {
    e.preventDefault();
    if (pending.current || !draft) return;
    if (!draft.name.trim()) { setNameError("请填写公司名称"); return; }
    pending.current = true; setBusy(true); setError(""); const version = sequence.current;
    try {
      const brand = await saveBrand(createClient(), previous, draft);
      if (version !== sequence.current) return;
      setPrevious(brand); setDraft(brand); setDirty(false);
      toast("公司品牌已保存，新报价开始使用");
      void member.refresh();
    } catch (err) { if (version === sequence.current) setError(err.message); }
    finally { if (version === sequence.current) { pending.current = false; setBusy(false); } }
  }

  if (!draft) return error ? <InlineError onRetry={() => void reload(false)}>{error}</InlineError> : <SkeletonList count={3} height={64} />;
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="row-between"><p className="small muted">新报价与产品卡片使用这里的资料；历史报价保留原样。</p>
        <MoreMenu items={[{ label: "重新读取", icon: "refresh", onSelect: () => void reload() }]} /></div>
      <label className="field"><span className="field-label">公司名称*</span>
        <input className="input" maxLength={120} value={draft.name} aria-invalid={!!nameError} disabled={busy} onChange={e => { edit({ name: e.target.value }); setNameError(""); }} />
        {nameError && <span className="field-error">{nameError}</span>}</label>
      <label className="field"><span className="field-label">联系方式</span>
        <input className="input" maxLength={180} value={draft.contact} disabled={busy} placeholder="电话、地址或网站" onChange={e => edit({ contact: e.target.value })} /></label>
      <div className="field"><span className="field-label">Logo</span>
        <div className="row" style={{ gap: 16 }}>
          <div className="logo-box">{draft.logo ? <img src={draft.logo} alt="公司 Logo" /> : <span className="small muted">{draft.logoError ? "读取失败" : "未上传"}</span>}</div>
          <div className="stack-sm">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileInput.current?.click()}>{draft.logo || draft.logo_path ? "更换" : "上传"}</button>
            {(draft.logo || draft.logo_path) && <button type="button" className="text-btn danger" disabled={busy} onClick={() => edit({ logo: "", logo_path: null, logoError: "", removeLogo: true })}>移除</button>}
          </div>
        </div>
        <input ref={fileInput} type="file" hidden aria-label="公司 Logo" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif"
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void upload(file); }} />
        <span className="field-hint">不超过 1MB，会自动转换为手机兼容格式。</span>
        {draft.logoError && <InlineError>{draft.logoError}</InlineError>}
      </div>
      <InlineError>{error}</InlineError>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !dirty}>{busy ? "保存中…" : "保存公司品牌"}</button>
    </form>
  );
}
