"use client";
// Platform recycle bin UI — docs/deletion-spec.md. Companies and accounts go to a 30-day
// recycle bin first; permanent deletion needs the exact name/e-mail plus an MFA code.
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { buildCompanyBackup, listAccounts, purgeAccount, purgeCompany, removeCompanyFiles, restoreAccount, restoreCompany, trashAccount, trashCompany, deletionError } from "../../lib/supabase/platform-deletion";
import { downloadFile } from "../share";
import { EmptyState, InlineError, MoreMenu, Pager, Sheet, SkeletonList, useConfirm, useToast } from "../ui";
import Icon from "../icons";

const daysLeft = until => Math.max(0, Math.ceil((Date.parse(until) - Date.now()) / 86400000));
const day = value => value ? new Date(value).toLocaleDateString("sv-SE") : "—";
const mb = bytes => (Number(bytes || 0) / 1048576).toFixed(1);

async function renderPdf(draft) {
  const { createQuotationPdf } = await import("../quotation-pdf");
  // A missing historic logo must not block the backup: render without it.
  const company = draft.company?.logoError ? { ...draft.company, logo: "" } : draft.company;
  return createQuotationPdf({ ...draft, company });
}

// Backup download (CSV + PDF ZIP parts). Used before deletion and inside the recycle bin.
export function BackupButton({ company, onDone, block = false }) {
  const toast = useToast();
  const [progress, setProgress] = useState(null), [error, setError] = useState("");
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);
  async function run() {
    setError(""); stop.current = false;
    try {
      const { files, counts } = await buildCompanyBackup(createClient(), company, { renderPdf, onProgress: setProgress, stopped: () => stop.current });
      if (stop.current) return;
      for (const [index, file] of files.entries()) { downloadFile(file); if (index < files.length - 1) await new Promise(r => setTimeout(r, 800)); }
      toast(`备份已下载：${counts.quotations} 张报价${files.length > 1 ? `，分 ${files.length} 个文件` : ""}`, { duration: 4000 });
      if (counts.pdfFailures) setError(`${counts.pdfFailures} 张报价的 PDF 生成失败，清单在备份文件「PDF生成失败.csv」里，CSV 资料完整。`);
      onDone?.(counts);
    } catch (err) { setError(err.message || "备份失败，请重试。"); }
    finally { setProgress(null); }
  }
  const label = !progress ? "下载备份（CSV + PDF）" : progress.stage === "pdf" ? `生成 PDF ${progress.done}/${progress.total}…` : progress.stage === "zip" ? "打包中…" : "读取资料…";
  return (
    <div className="stack-sm">
      <button type="button" className={`btn btn-secondary ${block ? "btn-block" : "btn-sm"}`} disabled={!!progress} onClick={run}><Icon name="download" size={18} />{label}</button>
      {progress?.stage === "pdf" && progress.total > 0 && <div className="progress"><div style={{ width: `${progress.done / progress.total * 100}%` }} /></div>}
      {progress && <p className="field-hint">请保持这个页面打开，报价多时需要几分钟。</p>}
      <InlineError>{error}</InlineError>
    </div>
  );
}

// Step 1 backup → step 2 type the company name → recycle bin.
export function DeleteCompanySheet({ company, onClose, onDone }) {
  const confirm = useConfirm(), toast = useToast();
  const [backedUp, setBackedUp] = useState(false), [typed, setTyped] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit() {
    if (typed.trim() !== company.name) { setError("公司名称不一致，请照着输入完整名称。"); return; }
    if (!backedUp && !(await confirm({ title: "不下载备份就删除？", message: "公司在回收箱的 30 天内仍可下载备份；永久删除后就无法再取得任何资料。", confirmLabel: "不备份，继续删除", danger: true }))) return;
    setBusy(true); setError("");
    try { await trashCompany(createClient(), company.id, typed.trim()); toast("公司已移入回收箱，30 天后永久删除"); onDone(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <Sheet title="删除公司" subtitle={company.name} onClose={busy ? undefined : onClose} footer={
      <button type="button" className="btn btn-danger-solid btn-block" disabled={busy || typed.trim() !== company.name} onClick={submit}>{busy ? "处理中…" : "移入回收箱"}</button>}>
      <div className="notice-box">移入回收箱后，全体成员立即不能访问，顾客目录链接全部失效。30 天内可以恢复；之后产品、报价、客户、图片会被永久删除。成员的登录账号不会被删除。</div>
      <section className="stack-sm"><h3 className="section-title">① 下载备份</h3>
        <BackupButton company={company} block onDone={() => setBackedUp(true)} />
        {backedUp && <p className="small" style={{ color: "var(--ok)" }}><Icon name="check" size={14} /> 已下载备份</p>}
      </section>
      <section className="stack-sm"><h3 className="section-title">② 确认删除</h3>
        <label className="field"><span className="field-label">请输入公司名称「{company.name}」</span>
          <input className="input" value={typed} autoComplete="off" onChange={e => { setTyped(e.target.value); setError(""); }} /></label>
        <InlineError>{error}</InlineError>
      </section>
    </Sheet>
  );
}

// Forced permanent deletion: exact name/e-mail + a fresh authenticator code.
function ForceDeleteSheet({ target, onClose, onDone }) {
  const toast = useToast();
  const [typed, setTyped] = useState(""), [code, setCode] = useState(""), [factor, setFactor] = useState(undefined);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [step, setStep] = useState("");
  const expected = target.kind === "company" ? target.name : target.email;
  useEffect(() => { createClient().auth.mfa.listFactors().then(r => setFactor(r.data?.totp?.find(f => f.status === "verified") || r.data?.totp?.[0] || null)).catch(() => setFactor(null)); }, []);
  const matches = target.kind === "company" ? typed.trim() === expected : typed.trim().toLowerCase() === String(expected).toLowerCase();
  async function submit() {
    if (!matches) { setError("输入内容不一致。"); return; }
    if (factor && !/^[0-9]{6}$/.test(code)) { setError("请输入验证器的 6 位验证码。"); return; }
    setBusy(true); setError("");
    try {
      const client = createClient();
      if (factor) { const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code }); if (verified.error) throw new Error("验证码不正确，请重试。"); }
      if (target.kind === "company") {
        setStep("正在删除图片文件…");
        await removeCompanyFiles(client, target.id, n => setStep(`已删除 ${n} 个图片文件…`));
        setStep("正在删除公司资料…");
        await purgeCompany(client, target.id, typed.trim());
        toast("公司已永久删除");
      } else {
        const result = await purgeAccount(client, target.id, typed.trim());
        toast(result?.email_released ? "账号已永久删除，这个邮箱可以重新注册" : "账号已永久删除；邮箱需在 Supabase 后台手动释放", { duration: 4500 });
      }
      onDone();
    } catch (err) { setError(err.message || deletionError(err)); }
    finally { setBusy(false); setStep(""); }
  }
  return (
    <Sheet title="永久删除" subtitle="这一步不能撤回" onClose={busy ? undefined : onClose} footer={
      <button type="button" className="btn btn-danger-solid btn-block" disabled={busy || !matches || factor === undefined} onClick={submit}>{busy ? (step || "处理中…") : "永久删除"}</button>}>
      <InlineError>{target.kind === "company"
        ? `「${target.name}」的产品、报价、客户、分类、分享链接和图片会被永久删除，只留一条删除记录。已下载或分享的文件无法召回。`
        : `${target.email} 的姓名和 WhatsApp 会被清空，只留「已删除用户」记录。之后这个邮箱可以注册新账号，旧资料不会回来。`}</InlineError>
      {target.kind === "company" && <BackupButton company={target} block />}
      <label className="field"><span className="field-label">请输入{target.kind === "company" ? "公司名称" : "账号邮箱"}「{expected}」</span>
        <input className="input" value={typed} autoComplete="off" onChange={e => { setTyped(e.target.value); setError(""); }} /></label>
      {factor && <label className="field"><span className="field-label">验证器 6 位验证码</span>
        <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} /></label>}
      <InlineError>{error}</InlineError>
    </Sheet>
  );
}

export function AccountsTab() {
  const toast = useToast();
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [offset, setOffset] = useState(0);
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(null), [typed, setTyped] = useState(""), [busy, setBusy] = useState(false), [sheetError, setSheetError] = useState("");
  useEffect(() => {
    let live = true; setLoading(true); setError("");
    listAccounts(createClient(), query, offset, "active").then(data => { if (live) setRows(data || []); }).catch(err => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query, offset, attempt]);
  async function submit() {
    setBusy(true); setSheetError("");
    try { await trashAccount(createClient(), deleting.user_id, typed.trim()); toast("账号已移入回收箱，30 天后永久删除"); setDeleting(null); setTyped(""); setAttempt(n => n + 1); }
    catch (err) { setSheetError(err.message); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <form className="search-row" onSubmit={e => { e.preventDefault(); setOffset(0); setQuery(search.trim()); }}>
        <div className="searchbox"><Icon name="search" size={20} /><input value={search} maxLength={254} placeholder="搜索邮箱或姓名" aria-label="搜索账号" onChange={e => setSearch(e.target.value)} /></div>
        <button type="submit" className="btn btn-secondary btn-sm">查询</button>
      </form>
      <InlineError onRetry={() => setAttempt(n => n + 1)}>{error}</InlineError>
      {loading ? <SkeletonList count={4} height={72} /> : !rows.length ? <EmptyState icon="users" title="没有符合的账号" /> : rows.map(row => {
        const blocked = row.is_platform ? "平台负责人账号不能删除" : row.primary_companies?.length ? `先在公司里更换正管理员：${row.primary_companies.join("、")}` : "";
        return (
          <article key={row.user_id} className="card data-card">
            <div className="row-between"><div className="grow"><strong className="ellipsis" style={{ display: "block" }}>{row.display_name || "姓名未填写"}</strong><p className="meta small ellipsis">{row.email}</p></div>
              <MoreMenu label={`${row.email} 的更多操作`} items={[{ label: "删除账号", icon: "trash", danger: true, disabled: !!blocked, onSelect: () => { setDeleting(row); setTyped(""); setSheetError(""); } }]} /></div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {row.is_platform && <span className="chip">平台负责人</span>}
              {row.primary_companies?.map(name => <span key={name} className="chip">正管理员 · {name}</span>)}
              <span className="small muted">{row.companies} 家公司 · 注册 {day(row.created_at)}</span>
            </div>
            {blocked && <p className="field-hint">{blocked}</p>}
          </article>
        );
      })}
      <Pager page={offset / 50} hasMore={rows.length >= 50} disabled={loading} onPrev={() => setOffset(v => Math.max(0, v - 50))} onNext={() => setOffset(v => v + 50)} />
      {deleting && <Sheet title="删除账号" subtitle={deleting.email} onClose={busy ? undefined : () => setDeleting(null)} footer={
        <button type="button" className="btn btn-danger-solid btn-block" disabled={busy || typed.trim().toLowerCase() !== deleting.email.toLowerCase()} onClick={submit}>{busy ? "处理中…" : "移入回收箱"}</button>}>
        <div className="notice-box">移入回收箱后，这个账号立即不能登录，在所有公司的访问都会停用，分享过的目录链接失效。30 天内可以恢复；之后清空个人资料，邮箱可重新注册。历史报价上的建立者名字不会改变。</div>
        <label className="field"><span className="field-label">请输入邮箱「{deleting.email}」</span>
          <input className="input" value={typed} autoComplete="off" onChange={e => { setTyped(e.target.value); setSheetError(""); }} /></label>
        <InlineError>{sheetError}</InlineError>
      </Sheet>}
    </div>
  );
}

export function TrashTab() {
  const confirm = useConfirm(), toast = useToast();
  const [kind, setKind] = useState("company"), [scope, setScope] = useState("trash");
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const [force, setForce] = useState(null), [busy, setBusy] = useState(false), [cleaning, setCleaning] = useState("");
  useEffect(() => {
    let live = true; setLoading(true); setError("");
    const client = createClient();
    const request = kind === "company"
      ? client.rpc("platform_list_companies", { search_text: "", page_offset: 0, list_scope: scope }).then(r => { if (r.error) throw new Error(deletionError(r.error)); return r.data; })
      : listAccounts(client, "", 0, scope);
    request.then(data => { if (live) setRows(data || []); }).catch(err => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [kind, scope, attempt]);

  async function restore(row) {
    const name = kind === "company" ? row.name : row.email;
    if (!(await confirm({ title: `恢复「${name}」？`, message: kind === "company" ? "恢复后成员可以重新访问公司。已失效的分享链接不会恢复。" : "恢复后账号可以登录，但公司访问需要重新邀请或在公司设置里恢复。", confirmLabel: "恢复" }))) return;
    setBusy(true);
    try { await (kind === "company" ? restoreCompany(createClient(), row.id) : restoreAccount(createClient(), row.user_id)); toast("已恢复"); setAttempt(n => n + 1); }
    catch (err) { toast(err.message); } finally { setBusy(false); }
  }
  async function cleanFiles(row) {
    setCleaning(row.id);
    try { const n = await removeCompanyFiles(createClient(), row.id); toast(`已清理 ${n} 个图片文件`); setAttempt(a => a + 1); }
    catch (err) { toast(err.message); } finally { setCleaning(""); }
  }

  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="类型">
        <button type="button" aria-pressed={kind === "company"} onClick={() => setKind("company")}>公司</button>
        <button type="button" aria-pressed={kind === "account"} onClick={() => setKind("account")}>账号</button>
      </div>
      <div className="segmented" role="group" aria-label="状态">
        <button type="button" aria-pressed={scope === "trash"} onClick={() => setScope("trash")}>回收箱</button>
        <button type="button" aria-pressed={scope === "purged"} onClick={() => setScope("purged")}>已永久删除</button>
      </div>
      {scope === "trash" && <div className="notice-box">回收箱保留 30 天，到期自动永久删除。期间可以恢复，也可以强行提前删除。</div>}
      <InlineError onRetry={() => setAttempt(n => n + 1)}>{error}</InlineError>
      {loading ? <SkeletonList count={3} height={96} /> : !rows.length ? <EmptyState icon="trash" title={scope === "trash" ? "回收箱是空的" : "没有已永久删除的记录"} /> : rows.map(row => {
        const isCompany = kind === "company", key = isCompany ? row.id : row.user_id;
        return (
          <article key={key} className="card data-card">
            <div className="row-between"><div className="grow">
              <strong className="ellipsis" style={{ display: "block" }}>{isCompany ? row.name : scope === "purged" ? "已删除用户" : (row.display_name || row.email)}</strong>
              {!isCompany && scope !== "purged" && <p className="meta small ellipsis">{row.email}</p>}
              {!isCompany && scope === "purged" && row.email_released && <p className="meta small">原邮箱已释放，可重新注册</p>}</div>
              {scope === "trash" ? <span className="pill pill-warn">剩 {daysLeft(row.purge_after)} 天</span> : <span className="pill pill-muted">已删除</span>}
            </div>
            <p className="meta small">{scope === "trash" ? `删除于 ${day(row.deleted_at)} · ${day(row.purge_after)} 永久删除` : `永久删除于 ${day(row.purged_at)}`}</p>
            {scope === "trash" && <div className="btn-row" style={{ flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void restore(row)}><Icon name="refresh" size={16} />恢复</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => setForce(isCompany ? { kind: "company", id: row.id, name: row.name } : { kind: "account", id: row.user_id, email: row.email })}>永久删除</button>
            </div>}
            {scope === "trash" && isCompany && <BackupButton company={row} />}
            {scope === "purged" && isCompany && Number(row.storage_bytes) > 0 && <div className="row-between">
              <span className="small" style={{ color: "var(--warn)" }}>还有 {mb(row.storage_bytes)} MB 图片文件待清理</span>
              <button type="button" className="btn btn-secondary btn-xs" disabled={cleaning === row.id} onClick={() => void cleanFiles(row)}>{cleaning === row.id ? "清理中…" : "清理文件"}</button></div>}
            {scope === "purged" && !isCompany && !row.email_released && <p className="small" style={{ color: "var(--warn)" }}>这个邮箱未能自动释放：请在 Supabase → Authentication → Users 把它改成其他邮箱，原邮箱才能重新注册。</p>}
            {scope === "trash" && !isCompany && !row.login_blocked && <p className="field-hint">登录由网站拦截（这个 Supabase 项目不允许自动封锁登录）。</p>}
          </article>
        );
      })}
      {force && <ForceDeleteSheet target={force} onClose={() => setForce(null)} onDone={() => { setForce(null); setAttempt(n => n + 1); }} />}
    </div>
  );
}
