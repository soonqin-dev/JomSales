"use client";
// PRC｜批量调价 — table mode: pick products → enter new prices → check → apply in batches.
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { readCategories } from "../../../lib/supabase/categories";
import { readPriceSnapshots, applyPriceBatches, PRICE_APPLY_TERMINAL } from "../../../lib/supabase/price-changes";
import { parseCsv } from "../../../lib/product-csv";
import { guessPriceMapping, previewPriceCsv, priceReportCsv, PRICE_STATUS } from "../../../lib/product-price-csv";
import { addPriceEditorProducts, priceEditorProduct, validatePriceEditorRows, preparePriceEditorRows, refreshPriceEditorBases, exportPriceEditorCsv } from "../../../lib/price-editor";
import { formatMoney, moneyToCents } from "../../quotation-utils";
import { downloadFile } from "../../share";
import { InlineError, MoreMenu, Pager, SearchBox, Sheet, SkeletonList, useConfirm, useLeaveGuard } from "../../ui";
import Icon from "../../icons";

const amount = value => value == null ? "—" : formatMoney(moneyToCents(value));

export default function PriceEditor({ context, blocked = false, onBusyChange }) {
  const confirm = useConfirm();
  const [query, setQuery] = useState(""), [category, setCategory] = useState(null), [categories, setCategories] = useState([]);
  const [catalog, setCatalog] = useState({ items: [], has_more: false }), [catalogPage, setCatalogPage] = useState(0), [loading, setLoading] = useState(false), [catalogError, setCatalogError] = useState("");
  const [drafts, setDrafts] = useState([]), [tablePage, setTablePage] = useState(0), [preview, setPreview] = useState(null), [results, setResults] = useState({});
  const [busy, setBusy] = useState(false), [begun, setBegun] = useState(false), [applying, setApplying] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [csvOpen, setCsvOpen] = useState(false), [text, setText] = useState(""), [filename, setFilename] = useState(""), [delimiter, setDelimiter] = useState(","), [parsed, setParsed] = useState(null), [mapping, setMapping] = useState({});
  const alive = useRef(true), working = useRef(false), stop = useRef(false), started = useRef(false), job = useRef(null), resultRef = useRef({}), sequence = useRef(0), cursors = useRef([null]), fileInput = useRef(null);
  const locked = busy || blocked || begun, dirty = drafts.length > 0;
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop.current = true; ++sequence.current; }; }, []);
  useLeaveGuard(dirty || started.current, { message: "离开会放弃调价表输入和本页进度；已提交的价格保留，不会回滚。", blocked: busy });

  async function run(task) {
    if (working.current || blocked) return;
    working.current = true; setBusy(true); onBusyChange?.(true); setError(""); setMessage("");
    try { await task(); } catch (err) { if (alive.current) setError(err.message || "操作未确认，表内输入仍保留。"); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusyChange?.(false); } }
  }
  async function loadCatalog() {
    if (working.current) return;
    const version = ++sequence.current; setLoading(true); setCatalogError("");
    try {
      const cursor = cursors.current[catalogPage], client = createClient();
      const result = await client.rpc("search_company_products", { target_company: context.companyId, search_text: query, after_created: cursor?.created_at || null, after_id: cursor?.id || null, category_filter: category });
      if (result.error) throw result.error;
      const cats = await readCategories(client, context.companyId);
      if (version === sequence.current) { setCatalog({ ...result.data, items: result.data.items.map(priceEditorProduct) }); setCategories(cats); }
    } catch (err) { if (version === sequence.current) { setCatalog({ items: [], has_more: false }); setCatalogError(err.message); } }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => { const timer = setTimeout(() => void loadCatalog(), 200); return () => { clearTimeout(timer); ++sequence.current; }; }, [query, category, catalogPage]);

  function invalidate() { setPreview(null); job.current = null; setResults({}); resultRef.current = {}; setError(""); setMessage(""); }
  function add(products) { if (locked) return; try { const next = addPriceEditorProducts(drafts, products); invalidate(); setDrafts(next); setMessage(`已选 ${next.length} 项，尚未修改价格。`); } catch (err) { setError(err.message); } }
  function edit(key, value) { if (locked) return; invalidate(); setDrafts(prev => prev.map(d => d.key === key ? { ...d, newPrice: value } : d)); }
  function remove(key) { if (locked) return; invalidate(); setDrafts(prev => { const next = prev.filter(d => d.key !== key); setTablePage(n => Math.min(n, Math.max(0, Math.ceil(next.length / 30) - 1))); return next; }); }
  async function newTask() {
    if (working.current || blocked) return;
    if (started.current && !(await confirm({ title: "开始新任务？", message: "会解锁输入并丢弃本页处理结果；已改的价格不会回滚。请先下载结果，再重读原价检查。", confirmLabel: "开始新任务", danger: true }))) return;
    started.current = false; setBegun(false); stop.current = false; invalidate(); setMessage("输入已解锁。请重读原价后重新检查，已改价格没有回滚。");
  }
  async function check() {
    if (locked || !drafts.length) return;
    await run(async () => {
      invalidate();
      const rows = validatePriceEditorRows(drafts), products = await readPriceSnapshots(createClient(), context.companyId, rows.filter(r => !r.error).map(r => r.serial), { stopped: () => !alive.current });
      if (!alive.current) return;
      const hydrated = refreshPriceEditorBases(drafts, products).map((d, i) => drafts[i].product ? drafts[i] : d);
      setDrafts(hydrated); setPreview(preparePriceEditorRows(drafts, products)); job.current = crypto.randomUUID();
      setMessage("检查完成，尚未写入价格。只有「可调价」的行会提交，其他行可修正后再检查。");
    });
  }
  async function refreshBases() {
    if (locked || !drafts.length) return;
    if (!(await confirm({ title: "重读原价？", message: "用最新原价替换表内原价，保留你填写的新价。不会修改任何价格。", confirmLabel: "重读原价" }))) return;
    await run(async () => {
      const products = await readPriceSnapshots(createClient(), context.companyId, drafts.filter(d => d.serial.trim() && d.serial.trim().length <= 120).map(d => d.serial), { stopped: () => !alive.current });
      if (alive.current) { setDrafts(refreshPriceEditorBases(drafts, products)); invalidate(); setMessage("原价已更新，新价保留，请重新检查。"); }
    });
  }
  async function apply() {
    if (working.current || blocked || !preview || !job.current) return;
    const pending = preview.filter(r => r.status === "ready" && !PRICE_APPLY_TERMINAL.has(resultRef.current[r.row_number]?.status));
    if (!pending.length || !(await confirm({ title: `提交 ${pending.length} 项新价格？`, message: "只改价格，不改其他产品资料或历史报价；有冲突的行不会被覆盖。", confirmLabel: "提交调价" }))) return;
    started.current = true; setBegun(true); stop.current = false; setApplying(true);
    await run(async () => {
      try {
        await applyPriceBatches(createClient(), context.companyId, job.current, pending, { results: resultRef.current, stopped: () => stop.current, onProgress: rows => { if (alive.current) setResults(rows); } });
        if (alive.current) setMessage(stop.current ? "已暂停，已提交的行保留，可继续。" : "本次处理完成；失败或冲突的行可开始新任务、重读原价后再检查。");
      } finally { if (alive.current) setApplying(false); }
    });
  }
  async function clearAll() {
    if (await confirm({ title: "清空待调价表？", message: "未提交的输入会被放弃。", confirmLabel: "清空", danger: true })) { invalidate(); setDrafts([]); setTablePage(0); }
  }
  function parse(content, separator) { const p = parseCsv(content, separator); setParsed(p); setMapping(guessPriceMapping(p.headers)); }
  async function choose(file) {
    if (!file || locked) return;
    await run(async () => {
      if (!/\.csv$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw new Error("请选择不超过 5MB 的 CSV UTF-8。");
      const content = await file.text();
      if (content.includes("�")) throw new Error("文件不是 UTF-8，请重新导出。");
      if (!alive.current) return;
      setText(content); setFilename(file.name); setParsed(null); parse(content, delimiter);
    });
  }
  async function importCsv() {
    if (locked || !parsed) return;
    if (drafts.length && !(await confirm({ title: "替换待调价表？", message: "导入会替换当前表内尚未提交的输入，不会修改任何价格。", confirmLabel: "替换" }))) return;
    await run(async () => {
      const rows = previewPriceCsv(parsed, mapping), next = rows.map(r => ({ key: crypto.randomUUID(), serial: r.serial, newPrice: r.raw_price, product: null }));
      const products = await readPriceSnapshots(createClient(), context.companyId, rows.filter(r => r.serial && r.serial.length <= 120).map(r => r.serial), { stopped: () => !alive.current });
      if (alive.current) { invalidate(); setDrafts(refreshPriceEditorBases(next, products)); setTablePage(0); setCsvOpen(false); setMessage("CSV 已导入表内；检查并确认前不会修改价格。"); }
    });
  }
  function catalogFilter(nextQuery, nextCategory) { if (locked) return; ++sequence.current; setCatalog({ items: [], has_more: false }); setLoading(true); cursors.current = [null]; setCatalogPage(0); setQuery(nextQuery); setCategory(nextCategory); }
  function nextCatalog(next) { if (locked || loading || next < 0) return; if (next > catalogPage) cursors.current[next] = catalog.cursor; setCatalog({ items: [], has_more: false }); setLoading(true); setCatalogPage(next); }
  function exportDraft() { try { downloadFile(new File([exportPriceEditorCsv(drafts)], "jomsales-price-editor.csv", { type: "text/csv;charset=utf-8" })); setMessage("已导出，可直接导回。Excel 中不要修改编号列。"); } catch (err) { setError(err.message); } }

  const pendingCount = preview?.filter(r => r.status === "ready" && !PRICE_APPLY_TERMINAL.has(results[r.row_number]?.status)).length || 0;
  const updated = Object.values(results).filter(r => r.status === "updated").length;
  const options = categories.filter(c => c.name && (c.active || Number(c.product_count) > 0));

  return (
    <div className="stack">
      <section className="card stack-sm" aria-labelledby="prc-candidates">
        <h3 className="section-title" id="prc-candidates">① 选产品</h3>
        <SearchBox value={query} onChange={value => catalogFilter(value, category)} placeholder="搜索编号或名称" disabled={locked} />
        <select className="input" aria-label="调价产品分类" value={JSON.stringify(category)} disabled={locked} onChange={e => catalogFilter(query, JSON.parse(e.target.value))}>
          <option value="null">全部分类</option><option value={'""'}>未分类</option>
          {options.map(c => <option key={c.name} value={JSON.stringify(c.name)}>{c.name}{!c.active && "（已停用）"}</option>)}
        </select>
        <InlineError onRetry={() => void loadCatalog()}>{catalogError}</InlineError>
        {loading ? <SkeletonList count={3} height={48} /> : !catalog.items.length ? <p className="small muted">没有符合的产品</p> : <>
          <button type="button" className="btn btn-secondary btn-sm" disabled={locked} onClick={() => add(catalog.items)}>加入本页全部（{catalog.items.length}）</button>
          <div className="list-card">{catalog.items.map(p => {
            const inTable = drafts.some(d => d.serial.trim().toLowerCase() === p.serial.toLowerCase());
            return <div key={p.id} className="list-row" style={{ minHeight: 48 }}>
              <span className="list-text"><span className="list-title" style={{ display: "block", fontSize: 14 }}>{p.name}</span><span className="list-desc">{p.serial} · {amount(p.price)}</span></span>
              <button type="button" className="btn btn-secondary btn-xs" disabled={locked || inTable} aria-label={`加入调价：${p.serial}`} onClick={() => add([p])}>{inTable ? "已加入" : "加入"}</button>
            </div>;
          })}</div>
        </>}
        <Pager page={catalogPage} hasMore={catalog.has_more} disabled={locked || loading} onPrev={() => nextCatalog(catalogPage - 1)} onNext={() => nextCatalog(catalogPage + 1)} label={`候选第 ${catalogPage + 1} 页`} />
      </section>

      <section className="card stack-sm" aria-labelledby="prc-draft">
        <div className="row-between"><h3 className="section-title" id="prc-draft">② 待调价表 <span className="small muted">{drafts.length} 项</span></h3>
          <MoreMenu label="调价表工具" disabled={busy || blocked} items={[
            { label: "导入 CSV 到表", icon: "upload", disabled: locked, onSelect: () => setCsvOpen(true) },
            { label: "导出 CSV", icon: "download", disabled: !drafts.length, onSelect: exportDraft },
            { label: "重读原价", icon: "refresh", disabled: locked || !drafts.length, onSelect: () => void refreshBases() },
            preview && { label: "下载检查／结果", icon: "doc", onSelect: () => downloadFile(new File([priceReportCsv(preview, results)], "jomsales-price-editor-results.csv", { type: "text/csv;charset=utf-8" })) },
            begun && { label: "开始新任务", icon: "plus", onSelect: () => void newTask() },
            { label: "清空", icon: "trash", danger: true, disabled: locked || !drafts.length, onSelect: () => void clearAll() }
          ]} /></div>
        {begun && <div className="notice-box">任务已开始，输入已锁定。要修改请「开始新任务」，已提交的价格不会回滚。</div>}
        {!drafts.length ? <p className="small muted">从上方加入产品，或导入 CSV。</p> : drafts.slice(tablePage * 30, tablePage * 30 + 30).map((d, i) => {
          const index = tablePage * 30 + i, row = preview?.[index], outcome = results[index + 1];
          const status = row && (row.error || outcome?.message || PRICE_STATUS[outcome?.status || row.status]);
          return (
            <div key={d.key} className="qte-item" style={{ gap: 6 }}>
              <div className="row-between">
                <div className="grow"><p className="qname" style={{ fontSize: 14 }}>{d.product?.name || "未匹配编号"}</p><p className="qmeta">第 {index + 1} 行 · {d.serial || "编号未填写"}</p></div>
                <button type="button" className="icon-btn" aria-label={`移除调价行 ${index + 1}`} disabled={locked} onClick={() => remove(d.key)}><Icon name="x" size={18} /></button>
              </div>
              {!d.product && <input className="input" style={{ minHeight: 40 }} aria-label={`修正编号：第 ${index + 1} 行`} disabled={locked} maxLength={120} value={d.serial}
                onChange={e => { if (locked) return; invalidate(); setDrafts(prev => prev.map(r => r.key === d.key ? { ...r, serial: e.target.value } : r)); }} />}
              <div className="row">
                <span className="small muted" style={{ minWidth: 96 }}>原价 {amount(d.product?.price)}</span>
                <div className="input-group grow" style={{ minHeight: 40 }}><span className="prefix">RM</span>
                  <input className="input" style={{ minHeight: 38 }} inputMode="decimal" aria-label={`表格新价：${d.serial}（第 ${index + 1} 行）`} disabled={locked} value={d.newPrice} onChange={e => edit(d.key, e.target.value)} /></div>
              </div>
              {status && <p className="small" style={{ color: row?.error || ["conflict", "unavailable", "failed", "invalid", "missing"].includes(outcome?.status || row?.status) ? "var(--danger)" : "var(--muted)" }}>{status}</p>}
            </div>
          );
        })}
        <Pager page={tablePage} hasMore={(tablePage + 1) * 30 < drafts.length} disabled={busy || blocked} onPrev={() => setTablePage(n => n - 1)} onNext={() => setTablePage(n => n + 1)} label={drafts.length > 30 ? `待调价第 ${tablePage + 1} 页` : undefined} />
      </section>

      {preview && <div className="stat-grid">
        <div className="stat"><p className="k">可提交</p><p className="v">{pendingCount}</p></div>
        <div className="stat"><p className="k">已调价</p><p className="v" style={{ color: "var(--ok)" }}>{updated}</p></div>
        <div className="stat"><p className="k">跳过／冲突</p><p className="v" style={{ color: "var(--danger)" }}>{preview.filter(r => !["ready", "unchanged"].includes(r.status)).length + Object.values(results).filter(r => ["conflict", "unavailable", "failed"].includes(r.status)).length}</p></div>
        <div className="stat"><p className="k">价格相同</p><p className="v">{preview.filter(r => r.status === "unchanged").length}</p></div>
      </div>}
      {message && <p className="small muted" role="status">{message}</p>}
      <InlineError>{error}</InlineError>

      {!!drafts.length && <div className="sticky-actions"><div className="btn-row">
        <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => void check()}>检查</button>
        {applying ? <button type="button" className="btn btn-secondary" onClick={() => { stop.current = true; }}>批次后暂停</button>
          : <button type="button" className="btn btn-primary" disabled={busy || blocked || !pendingCount} onClick={() => void apply()}>{begun ? "继续／重试" : "提交调价"}</button>}
      </div></div>}

      {csvOpen && <Sheet title="导入 CSV 到调价表" subtitle="只放进表内，确认前不会修改价格" onClose={() => setCsvOpen(false)} footer={
        <button type="button" className="btn btn-primary btn-block" disabled={locked || !parsed} onClick={() => void importCsv()}>导入到调价表</button>}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={locked} onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} />{text ? "重选文件" : "选择 CSV"}</button>
        <input ref={fileInput} type="file" hidden accept=".csv,text/csv" aria-label="导入调价表 CSV" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void choose(file); }} />
        {text && <p className="small"><Icon name="doc" size={14} /> {filename}</p>}
        {text && <label className="field"><span className="field-label">分隔符</span><select className="input" aria-label="表格 CSV 分隔符" disabled={locked} value={delimiter}
          onChange={e => { setDelimiter(e.target.value); setParsed(null); try { parse(text, e.target.value); setError(""); } catch (err) { setError(err.message); } }}>
          <option value=",">逗号</option><option value=";">分号</option><option value={"\t"}>Tab</option></select></label>}
        {parsed && [["serial", "编号列"], ["price", "新价列"]].map(([key, label]) => <label key={key} className="field"><span className="field-label">{label}</span>
          <select className="input" aria-label={`表格 CSV ${label}`} disabled={locked} value={mapping[key] ?? -1} onChange={e => setMapping({ ...mapping, [key]: Number(e.target.value) })}>
            <option value={-1}>请选择</option>{parsed.headers.map((header, i) => <option value={i} key={i}>{header}</option>)}</select></label>)}
        <InlineError>{error}</InlineError>
      </Sheet>}
    </div>
  );
}
