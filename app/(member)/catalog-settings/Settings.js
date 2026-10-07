"use client";
// Catalog tools — docs/pages-spec.md §6: CTG / NUM / IMP / PRC / VIS as tabs (?tab=…).
// Inactive tabs stay mounted (hidden) so switching never drops an import or price job.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { parseCsv, guessMapping, previewCsv, CSV_FIELDS, csvTemplate } from "../../../lib/product-csv";
import { downloadFile } from "../../share";
import { useMember } from "../../member-context";
import { EmptyState, InlineError, SkeletonList, TopBar, useConfirm, useLeaveGuard, useToast } from "../../ui";
import Icon from "../../icons";
import PriceUpdate from "./PriceUpdate";
import Categories from "./Categories";
import PriceEditor from "./PriceEditor";
import Visibility from "./Visibility";

const TABS = [["categories", "分类", "产品分类"], ["numbers", "编号", "产品编号规则"], ["import", "导入", "批量新增产品"], ["prices", "调价", "批量调价"], ["public", "公开", "产品公开设置"]];

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
async function rpc(name, args) { const result = await createClient().rpc(name, args); if (result.error) throw result.error; return result.data; }

export default function CatalogSettings() {
  const member = useMember();
  const [tab, setTab] = useState("categories"), [priceMode, setPriceMode] = useState("table");
  const [busyMap, setBusyMap] = useState({});
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some(([key]) => key === value)) setTab(value);
  }, []);
  const busyFor = name => value => setBusyMap(prev => (prev[name] === value ? prev : { ...prev, [name]: value }));
  const blockedBy = name => Object.entries(busyMap).some(([key, value]) => key !== name && value);
  // Each tool guards its own unsaved input or running job; plain reads never block leaving.
  const anyBusy = Object.values(busyMap).some(Boolean);

  function choose(next) {
    if (anyBusy) return;
    setTab(next);
    const url = new URL(window.location.href); url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }

  if (member.role !== "admin") return <main className="app-main"><TopBar title="产品工具" back="/me" />
    <EmptyState icon="lock" title="这个页面仅供公司管理员使用" action={<Link href="/cloud" className="btn btn-secondary btn-sm">回到产品目录</Link>} /></main>;

  const title = TABS.find(([key]) => key === tab)[2];
  return (
    <main className="app-main">
      <TopBar title={title} subtitle={member.name} back="/admin" />
      <div className="stack">
        <div className="segmented" role="tablist" aria-label="产品工具" style={{ overflowX: "auto" }}>
          {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key} disabled={anyBusy && tab !== key} onClick={() => choose(key)}>{label}</button>)}
        </div>
        {anyBusy && <p className="field-hint">正在处理，完成或暂停后才能切换分区。</p>}
        <div hidden={tab !== "categories"}><Categories context={member} blocked={blockedBy("categories")} onBusyChange={busyFor("categories")} /></div>
        <div hidden={tab !== "numbers"}><NumberSettings blocked={blockedBy("numbers")} onBusyChange={busyFor("numbers")} /></div>
        <div hidden={tab !== "import"}><ImportProducts blocked={blockedBy("import")} onBusyChange={busyFor("import")} /></div>
        <div hidden={tab !== "prices"} className="stack">
          <div className="segmented" role="group" aria-label="调价方式">
            <button type="button" aria-pressed={priceMode === "table"} disabled={anyBusy} onClick={() => setPriceMode("table")}>调价表</button>
            <button type="button" aria-pressed={priceMode === "csv"} disabled={anyBusy} onClick={() => setPriceMode("csv")}>CSV 文件</button>
          </div>
          <div hidden={priceMode !== "table"}><PriceEditor context={member} blocked={blockedBy("table")} onBusyChange={busyFor("table")} /></div>
          <div hidden={priceMode !== "csv"}><PriceUpdate context={member} blocked={blockedBy("csv")} onBusyChange={busyFor("csv")} /></div>
        </div>
        <div hidden={tab !== "public"}><Visibility blocked={blockedBy("public")} onBusyChange={busyFor("public")} /></div>
      </div>
    </main>
  );
}

// NUM｜产品编号规则
function NumberSettings({ blocked, onBusyChange }) {
  const member = useMember(), confirm = useConfirm(), toast = useToast();
  const [settings, setSettings] = useState(null), [draft, setDraft] = useState(null), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const working = useRef(false), sequence = useRef(0);
  useLeaveGuard(dirty, { message: "编号规则还没保存。" });

  async function run(task) {
    if (working.current || blocked) return;
    working.current = true; setBusy(true); onBusyChange(true); setError("");
    try { await task(); } catch (err) { setError(err.message || "操作失败，输入仍保留。"); }
    finally { working.current = false; setBusy(false); onBusyChange(false); }
  }
  async function read(ask = true) {
    if (ask && dirty && !(await confirm({ title: "重新读取？", message: "未保存的编号修改会被放弃。", confirmLabel: "重新读取", danger: true }))) return;
    await run(async () => {
      const version = ++sequence.current;
      const row = await rpc("get_product_number_settings", { target_company: member.companyId });
      if (version !== sequence.current) return;
      const value = Array.isArray(row) ? row[0] : row;
      setSettings(value); setDraft(value); setDirty(false);
    });
  }
  useEffect(() => { void read(false); return () => { ++sequence.current; }; }, []);
  const edit = (key, value) => { setDraft(prev => ({ ...prev, [key]: value })); setDirty(true); };

  async function save(event) {
    event.preventDefault();
    await run(async () => {
      const row = await rpc("save_product_number_settings", { target_company: member.companyId, expected_revision: settings.revision,
        auto_number: draft.automatic, number_prefix: draft.prefix, number_digits: Number(draft.digits), next_value: Number(draft.next_number) });
      const value = Array.isArray(row) ? row[0] : row;
      setSettings(value); setDraft(value); setDirty(false);
      toast("编号规则已保存，只影响之后的新产品");
    });
  }

  if (!draft) return error ? <InlineError onRetry={() => void read(false)}>{error}</InlineError> : <SkeletonList count={3} height={56} />;
  const digits = Math.min(12, Math.max(1, Number(draft.digits) || 1));
  return (
    <form className="stack" onSubmit={save}>
      <div className="segmented" role="group" aria-label="编号方式">
        <button type="button" aria-pressed={draft.automatic} disabled={busy} onClick={() => edit("automatic", true)}>自动编号</button>
        <button type="button" aria-pressed={!draft.automatic} disabled={busy} onClick={() => edit("automatic", false)}>必须手填</button>
      </div>
      <p className="field-hint">{draft.automatic ? "新增产品时编号留空会自动生成，也可以手动填写。" : "新增产品时必须手动填写编号。"}</p>
      {draft.automatic && <>
        <div className="fields-2">
          <label className="field"><span className="field-label">前缀</span>
            <input className="input" maxLength={30} value={draft.prefix} disabled={busy} onChange={e => edit("prefix", e.target.value)} /></label>
          <label className="field"><span className="field-label">位数</span>
            <input className="input" type="number" required min={1} max={12} value={draft.digits} disabled={busy} onChange={e => edit("digits", e.target.value)} /></label>
        </div>
        <label className="field"><span className="field-label">下一个流水号</span>
          <input className="input" type="number" required min={1} max={999999999999} value={draft.next_number} disabled={busy} onChange={e => edit("next_number", e.target.value)} /></label>
        <div className="card flat row-between"><span className="small muted">预览</span><strong className="num">{draft.prefix}{String(draft.next_number).padStart(digits, "0")}</strong></div>
        <p className="field-hint">允许跳号，已被占用的编号会自动避开。</p>
      </>}
      <InlineError>{error}</InlineError>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" disabled={busy || blocked} onClick={() => void read()}>重新读取</button>
        <button type="submit" className="btn btn-primary" disabled={busy || blocked || !dirty}>{busy ? "保存中…" : "保存规则"}</button>
      </div>
    </form>
  );
}

// IMP｜批量新增产品 — preview first; only new codes are inserted, existing ones are skipped.
function ImportProducts({ blocked, onBusyChange }) {
  const member = useMember(), confirm = useConfirm(), toast = useToast();
  const [busy, setBusy] = useState(false), [importing, setImporting] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [text, setText] = useState(""), [filename, setFilename] = useState(""), [delimiter, setDelimiter] = useState(","), [parsed, setParsed] = useState(null), [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null), [results, setResults] = useState({}), [progress, setProgress] = useState(0);
  const working = useRef(false), importId = useRef(null), started = useRef(false), stop = useRef(false), resultRef = useRef({}), fileInput = useRef(null);
  useEffect(() => () => { stop.current = true; }, []);
  useLeaveGuard(!!text || started.current, { message: "离开会丢失这次导入的预览和进度；已新增的产品会保留。", blocked: importing });

  async function run(task) {
    if (working.current || blocked) return;
    working.current = true; setBusy(true); onBusyChange(true); setError(""); setMessage("");
    try { await task(); } catch (err) { setError(err.message || "操作失败，当前输入仍保留。"); }
    finally { working.current = false; setBusy(false); onBusyChange(false); }
  }
  async function resetImport() {
    if (working.current) return false;
    if (started.current && !(await confirm({ title: "开始新的预览？", message: "已新增的产品不会删除。", confirmLabel: "重新预览" }))) return false;
    setPreview(null); setResults({}); resultRef.current = {}; setProgress(0); importId.current = null; started.current = false; return true;
  }
  function parse(textValue = text, separator = delimiter) {
    const value = parseCsv(textValue, separator); setParsed(value); setMapping(guessMapping(value.headers));
    setPreview(null); setError("");
  }
  async function choose(file) {
    if (!file || !(await resetImport())) return;
    await run(async () => {
      if (!/\.csv$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw new Error("请选择不超过 5MB 的 CSV 文件。Excel 请先另存为 CSV UTF-8。");
      const content = await file.text();
      if (content.includes("�")) throw new Error("文件不是有效 UTF-8，请从 Excel 另存为 CSV UTF-8。");
      setText(content); setFilename(file.name); setParsed(null); parse(content);
    });
  }
  async function inspect() {
    await run(async () => {
      const rows = previewCsv(parsed, mapping), codes = rows.filter(row => row.fields && !row.error).map(row => row.fields.serial), existing = new Set();
      for (let offset = 0; offset < codes.length; offset += 500) {
        const duplicates = await rpc("check_product_import_codes", { target_company: member.companyId, codes: codes.slice(offset, offset + 500) });
        for (const code of duplicates || []) existing.add(code);
      }
      setPreview(rows.map(row => ({ ...row, duplicate: !!row.fields && existing.has(row.fields.serial.toLowerCase()) })));
      importId.current = crypto.randomUUID(); setMessage("预览完成，尚未写入产品。已有编号会跳过，不覆盖。");
    });
  }
  async function importRows() {
    if (working.current || !preview || !importId.current) return;
    const valid = preview.filter(row => row.fields && !row.error && !row.duplicate);
    const pending = valid.filter(row => !["imported", "duplicate"].includes(resultRef.current[row.row_number]?.status));
    if (!pending.length || !(await confirm({ title: `新增 ${pending.length} 项产品？`, message: "只新增，不覆盖已有产品。", confirmLabel: "确认新增" }))) return;
    started.current = true; stop.current = false; setImporting(true);
    await run(async () => {
      try {
        for (let offset = 0; offset < pending.length && !stop.current; offset += 100) {
          const batch = pending.slice(offset, offset + 100);
          const rows = await rpc("import_products_batch", { target_company: member.companyId, import_key: importId.current,
            entries: batch.map(row => ({ row_number: row.row_number, ...row.fields })) });
          if (!Array.isArray(rows) || rows.length !== batch.length) throw new Error("结果未确认，请保留页面并重试。");
          for (const row of rows) resultRef.current[row.row_number] = row;
          setResults({ ...resultRef.current }); setProgress(Object.values(resultRef.current).filter(row => row.status === "imported").length);
        }
        setMessage(stop.current ? "已暂停。已新增的产品保留，可继续导入。" : "本次处理完成。失败项目可再点继续重试；需要改 CSV 时重新预览。");
        if (!stop.current) toast("导入处理完成");
      } finally { setImporting(false); }
    });
  }
  function report() {
    const lines = [["CSV行号", "产品编号", "名称", "结果", "说明"], ...(preview || []).map(row => {
      const outcome = results[row.row_number];
      return [row.csv_line, row.fields?.serial || row.raw_serial || "", row.fields?.name || row.raw_name || "", row.error ? "格式错误" : row.duplicate ? "已有编号" : outcome?.status || "未处理", row.error || outcome?.message || (row.duplicate ? "已跳过，不覆盖" : "")];
    })];
    downloadFile(new File(["﻿" + lines.map(row => row.map(csvCell).join(",")).join("\r\n")], "jomsales-import-results.csv", { type: "text/csv;charset=utf-8" }));
  }

  const validCount = preview?.filter(row => !row.error && !row.duplicate).length || 0;
  const step = preview ? (started.current ? 4 : 3) : parsed ? 2 : 1;
  const failed = Object.values(results).filter(row => row.status === "failed").length;
  return (
    <div className="stack">
      <ol className="chips" aria-label="导入步骤" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {["选文件", "对应字段", "检查预览", "导入"].map((label, i) => <li key={label} className={`pill ${step === i + 1 ? "pill-navy" : step > i + 1 ? "pill-outline" : "pill-muted"}`}>{i + 1} {label}</li>)}
      </ol>
      <div className="notice-box">只新增，不覆盖已有产品；暂不支持批量上传图片。一次最多 10,000 项、5MB。</div>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => downloadFile(new File([csvTemplate()], "jomsales-products-template.csv", { type: "text/csv;charset=utf-8" }))}><Icon name="download" size={16} />下载模板</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || blocked || importing} onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} />{text ? "重选文件" : "选择 CSV"}</button>
      </div>
      <input ref={fileInput} type="file" hidden accept=".csv,text/csv" aria-label="选择 CSV 文件" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void choose(file); }} />
      {text && <div className="row-between"><span className="small ellipsis"><Icon name="doc" size={16} /> {filename}</span>
        <label className="row small">分隔符<select className="input" style={{ minHeight: 36, width: 100 }} value={delimiter} disabled={busy || started.current}
          onChange={e => { setDelimiter(e.target.value); try { parse(text, e.target.value); } catch (err) { setParsed(null); setError(err.message); } }}>
          <option value=",">逗号</option><option value=";">分号</option><option value={"\t"}>Tab</option></select></label></div>}
      {parsed && <section className="card stack-sm"><h3 className="section-title">对应字段</h3>
        {CSV_FIELDS.map(([field, label]) => <label key={field} className="row-between"><span className="small" style={{ fontWeight: 600 }}>{label}</span>
          <select className="input" style={{ minHeight: 40, maxWidth: "60%" }} value={mapping[field] ?? -1} disabled={busy || started.current}
            onChange={e => { setMapping({ ...mapping, [field]: Number(e.target.value) }); setPreview(null); importId.current = null; }}>
            <option value={-1}>不导入</option>{parsed.headers.map((header, index) => <option value={index} key={index}>{header}</option>)}</select></label>)}
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || blocked || started.current} onClick={() => void inspect()}>预览检查</button>
      </section>}
      {preview && <>
        <div className="stat-grid">
          <div className="stat"><p className="k">总行数</p><p className="v">{preview.length}</p></div>
          <div className="stat"><p className="k">可新增</p><p className="v" style={{ color: "var(--ok)" }}>{validCount}</p></div>
          <div className="stat"><p className="k">格式错误</p><p className="v" style={{ color: "var(--danger)" }}>{preview.filter(row => row.error).length}</p></div>
          <div className="stat"><p className="k">已有编号</p><p className="v" style={{ color: "var(--warn)" }}>{preview.filter(row => row.duplicate).length}</p></div>
        </div>
        {started.current && <div className="stack-sm">
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={validCount} aria-valuenow={progress}><div style={{ width: `${validCount ? progress / validCount * 100 : 0}%` }} /></div>
          <p className="small muted" role="status">已新增 {progress} / {validCount} · 失败 {failed} · 导入期间重复 {Object.values(results).filter(row => row.status === "duplicate").length}</p>
        </div>}
        <div className="btn-row">
          {importing ? <button type="button" className="btn btn-secondary" onClick={() => { stop.current = true; }}>批次结束后暂停</button>
            : <button type="button" className="btn btn-primary" disabled={busy || blocked || !validCount} onClick={() => void importRows()}>{started.current ? "继续／重试" : "确认新增"}</button>}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={report}><Icon name="download" size={16} />下载结果</button>
        </div>
        <button type="button" className="text-btn" disabled={busy} onClick={async () => { if (await resetImport()) setMessage("可以修改字段对应后重新预览。"); }}>重新预览</button>
        <div className="table-scroll"><table>
          <thead><tr><th>行</th><th>编号</th><th>名称</th><th>状态</th></tr></thead>
          <tbody>{preview.slice(0, 20).map(row => <tr key={row.row_number}>
            <td>{row.csv_line}</td><td>{row.fields?.serial || row.raw_serial || "—"}</td><td>{row.fields?.name || row.raw_name}</td>
            <td style={{ color: row.error ? "var(--danger)" : row.duplicate ? "var(--warn)" : undefined }}>{row.error || (row.duplicate ? "已有编号，跳过" : results[row.row_number]?.message || results[row.row_number]?.status || "待新增")}</td>
          </tr>)}</tbody></table></div>
        {preview.length > 20 && <p className="field-hint">只显示前 20 行；完整结果请下载。</p>}
      </>}
      {message && <p className="small muted" role="status">{message}</p>}
      <InlineError>{error}</InlineError>
    </div>
  );
}
