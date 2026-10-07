"use client";
// PRC｜批量调价 — CSV mode: choose file → map columns → preview old/new prices → apply in batches.
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { parseCsv } from "../../../lib/product-csv";
import { previewPriceCsv, guessPriceMapping, matchPricePreview, priceReportCsv, PRICE_FIELDS, PRICE_STATUS } from "../../../lib/product-price-csv";
import { readPriceSnapshots, applyPriceBatches, PRICE_APPLY_TERMINAL } from "../../../lib/supabase/price-changes";
import { downloadFile } from "../../share";
import { formatMoney, moneyToCents } from "../../quotation-utils";
import { InlineError, useConfirm, useLeaveGuard } from "../../ui";
import Icon from "../../icons";

const terminal = PRICE_APPLY_TERMINAL;
const amount = value => value == null ? "—" : formatMoney(moneyToCents(value));

export default function PriceUpdate({ context, blocked = false, onBusyChange }) {
  const confirm = useConfirm();
  const [text, setText] = useState(""), [filename, setFilename] = useState(""), [delimiter, setDelimiter] = useState(","), [parsed, setParsed] = useState(null), [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null), [results, setResults] = useState({}), [busy, setBusy] = useState(false), [applying, setApplying] = useState(false), [begun, setBegun] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const working = useRef(false), stop = useRef(false), alive = useRef(true), job = useRef(null), started = useRef(false), resultRef = useRef({}), fileInput = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; }; }, []);
  useLeaveGuard(started.current, { message: "离开会丢失本页调价进度；已修改的价格保留，不会回滚。", blocked: busy });

  async function run(task) {
    if (working.current || blocked) return;
    working.current = true; setBusy(true); onBusyChange?.(true); setError(""); setMessage("");
    try { await task(); } catch (err) { if (alive.current) setError(err.message || "操作未确认，请保留本页并重试；预览仍保留。"); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusyChange?.(false); } }
  }
  async function reset() {
    if (working.current || blocked) return false;
    if (started.current && !(await confirm({ title: "重新预览？", message: "会开始新任务，已修改的价格不会自动恢复。", confirmLabel: "重新预览" }))) return false;
    setPreview(null); setResults({}); resultRef.current = {}; job.current = null; started.current = false; setBegun(false); return true;
  }
  function parse(content, separator) { const p = parseCsv(content, separator); setParsed(p); setMapping(guessPriceMapping(p.headers)); }
  async function choose(file) {
    if (!file || !(await reset())) return;
    await run(async () => {
      if (!/\.csv$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw new Error("请选择不超过 5MB 的 CSV UTF-8 文件。");
      const content = await file.text();
      if (!alive.current) return;
      if (content.includes("�")) throw new Error("文件不是有效 UTF-8，请从 Excel 另存为 CSV UTF-8。");
      setText(content); setFilename(file.name); setParsed(null); parse(content, delimiter);
    });
  }
  async function inspect() {
    await run(async () => {
      setPreview(null); job.current = null;
      const rows = previewPriceCsv(parsed, mapping), codes = rows.filter(r => !r.error).map(r => r.serial);
      const products = await readPriceSnapshots(createClient(), context.companyId, codes, { stopped: () => stop.current });
      if (!alive.current) return;
      setPreview(matchPricePreview(rows, products)); job.current = crypto.randomUUID();
      setMessage("预览完成，尚未修改价格。只按编号匹配，不会改名称、照片等其他资料。");
    });
  }
  async function apply() {
    if (working.current || blocked || !preview || !job.current) return;
    const pending = preview.filter(r => r.status === "ready" && !terminal.has(resultRef.current[r.row_number]?.status));
    if (!pending.length || !(await confirm({ title: `修改 ${pending.length} 项产品价格？`, message: "只修改价格，不改名称、照片或已保存报价；预览后被改动过的产品会跳过。", confirmLabel: "确认调价" }))) return;
    started.current = true; setBegun(true); stop.current = false; setApplying(true);
    await run(async () => {
      try {
        await applyPriceBatches(createClient(), context.companyId, job.current, pending, { results: resultRef.current, stopped: () => stop.current, onProgress: rows => { if (alive.current) setResults(rows); } });
        if (alive.current) setMessage(stop.current ? "调价已暂停，已修改的价格保留，可继续。" : "本次调价处理完成。冲突或无效的行需重新预览。");
      } finally { if (alive.current) setApplying(false); }
    });
  }

  const locked = busy || blocked, ready = preview?.filter(r => r.status === "ready").length || 0;
  const remaining = preview?.filter(r => r.status === "ready" && !terminal.has(results[r.row_number]?.status)).length || 0;
  const errors = preview?.filter(r => r.status === "invalid").length || 0, missing = preview?.filter(r => r.status === "missing").length || 0, unchanged = preview?.filter(r => r.status === "unchanged").length || 0;
  const updated = Object.values(results).filter(r => r.status === "updated").length, conflicts = Object.values(results).filter(r => ["conflict", "unavailable", "failed"].includes(r.status)).length;

  return (
    <div className="stack">
      <div className="notice-box">只修改现有产品的价格，不新增产品。编号不分大小写、保留前导零；空白价格不当作 0。最多 10,000 行、5MB。</div>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled={locked} onClick={() => downloadFile(new File(["﻿SKU,Price\r\nYOUR-SKU,12.50\r\n"], "jomsales-price-template.csv", { type: "text/csv;charset=utf-8" }))}><Icon name="download" size={16} />下载模板</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={locked || applying} onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} />{text ? "重选文件" : "选择 CSV"}</button>
      </div>
      <input ref={fileInput} type="file" hidden accept=".csv,text/csv" aria-label="选择调价 CSV 文件" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void choose(file); }} />
      {text && <div className="row-between"><span className="small ellipsis"><Icon name="doc" size={16} /> {filename}</span>
        <label className="row small">分隔符<select className="input" style={{ minHeight: 36, width: 100 }} aria-label="调价分隔符" value={delimiter} disabled={locked || begun}
          onChange={e => { setDelimiter(e.target.value); setPreview(null); job.current = null; setParsed(null); try { parse(text, e.target.value); setError(""); } catch (err) { setError(err.message); } }}>
          <option value=",">逗号</option><option value=";">分号</option><option value={"\t"}>Tab</option></select></label></div>}
      {parsed && <section className="card stack-sm">
        {PRICE_FIELDS.map(([key, label]) => <label key={key} className="row-between"><span className="small" style={{ fontWeight: 600 }}>{label}</span>
          <select className="input" style={{ minHeight: 40, maxWidth: "60%" }} aria-label={label} value={mapping[key] ?? -1} disabled={locked || begun}
            onChange={e => { setMapping({ ...mapping, [key]: Number(e.target.value) }); setPreview(null); job.current = null; }}>
            <option value={-1}>请选择</option>{parsed.headers.map((header, i) => <option value={i} key={i}>{header}</option>)}</select></label>)}
        <button type="button" className="btn btn-primary btn-sm" disabled={locked || begun} onClick={() => { stop.current = false; void inspect(); }}>预览新旧价格</button>
      </section>}
      {preview && <>
        <div className="stat-grid">
          <div className="stat"><p className="k">可调价</p><p className="v">{ready}</p></div>
          <div className="stat"><p className="k">价格相同</p><p className="v">{unchanged}</p></div>
          <div className="stat"><p className="k">编号不存在</p><p className="v" style={{ color: "var(--warn)" }}>{missing}</p></div>
          <div className="stat"><p className="k">格式错误／重复</p><p className="v" style={{ color: "var(--danger)" }}>{errors}</p></div>
        </div>
        {begun && <p className="small muted" role="status">已调价 {updated} · 冲突／失败 {conflicts} · 未完成 {remaining}</p>}
        <div className="btn-row">
          {applying ? <button type="button" className="btn btn-secondary" onClick={() => { stop.current = true; }}>批次后暂停</button>
            : <button type="button" className="btn btn-primary" disabled={locked || !remaining} onClick={() => void apply()}>{begun ? "继续／重试" : "确认调价"}</button>}
          <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => downloadFile(new File([priceReportCsv(preview, results)], "jomsales-price-results.csv", { type: "text/csv;charset=utf-8" }))}><Icon name="download" size={16} />下载结果</button>
        </div>
        <button type="button" className="text-btn" disabled={locked} onClick={async () => { if (await reset()) { stop.current = false; setMessage("可以重新选择列，再预览最新价格。"); } }}>重新预览</button>
        <div className="table-scroll"><table>
          <thead><tr><th>行</th><th>编号</th><th>原价</th><th>新价</th><th>状态</th></tr></thead>
          <tbody>{preview.slice(0, 20).map(row => <tr key={row.row_number}>
            <td>{row.csv_line}</td><td>{row.serial || "—"}</td><td>{amount(row.old_price)}</td><td>{amount(row.new_price)}</td>
            <td>{row.error || results[row.row_number]?.message || PRICE_STATUS[results[row.row_number]?.status || row.status]}</td></tr>)}</tbody></table></div>
        {preview.length > 20 && <p className="field-hint">只显示前 20 行；完整结果请下载。</p>}
      </>}
      {message && <p className="small muted" role="status">{message}</p>}
      <InlineError>{error}</InlineError>
    </div>
  );
}
