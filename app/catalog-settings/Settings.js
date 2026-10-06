"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import useCompanyScope from "../use-company-scope";
import { parseCsv, guessMapping, previewCsv, CSV_FIELDS, csvTemplate } from "../../lib/product-csv";
import { downloadFile } from "../share";
import PriceUpdate from "./PriceUpdate";
import Categories from "./Categories";
import PriceEditor from './PriceEditor';

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function Editor({ context }) {
  const [settings, setSettings] = useState(null), [numberDraft, setNumberDraft] = useState(null), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [importing, setImporting] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [text, setText] = useState(""), [filename, setFilename] = useState(""), [delimiter, setDelimiter] = useState(","), [parsed, setParsed] = useState(null), [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null), [results, setResults] = useState({}), [progress, setProgress] = useState(0);
  const [priceBusy,setPriceBusy]=useState(false);
  const [categoryBusy,setCategoryBusy]=useState(false);
  const [tableBusy,setTableBusy]=useState(false);
  const working = useRef(false), sequence = useRef(0), importId = useRef(null), started = useRef(false), stop = useRef(false), resultRef = useRef({});
  async function rpc(name, args) { const result = await createClient().rpc(name, args); if (result.error) throw result.error; return result.data; }
  async function run(task) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setMessage("");
    try { await task(); } catch (err) { setError(err.message || "操作失败，当前输入仍保留。"); }
    finally { working.current = false; setBusy(false); }
  }
  async function readNumbers() {
    await run(async () => {
      const version = ++sequence.current;
      const row = await rpc("get_product_number_settings", { target_company: context.companyId });
      if (version !== sequence.current) return;
      const value = Array.isArray(row) ? row[0] : row;
      setSettings(value); setNumberDraft(value); setDirty(false);
    });
  }
  useEffect(() => { void readNumbers(); return () => { ++sequence.current; stop.current = true; }; }, []);
  useEffect(() => {
    const leave = event => { if (busy || dirty || started.current) { event.preventDefault(); event.returnValue = ""; } };
    const link = event => {
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;
      if ((busy || dirty || started.current) && (busy || !window.confirm("离开将丢失未保存配置和当前导入进度；已导入产品保留。继续？"))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", leave); document.addEventListener("click", link, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", link, true); };
  }, [busy, dirty]);
  function resetImport() {
    if (working.current || (started.current && !window.confirm("开始新的预览？已导入产品不会删除。"))) return false;
    setPreview(null); setResults({}); resultRef.current = {}; setProgress(0); importId.current = null; started.current = false; return true;
  }
  function parse(textValue = text, separator = delimiter) {
    const value = parseCsv(textValue, separator); setParsed(value); setMapping(guessMapping(value.headers));
    setPreview(null); setError("");
  }
  async function choose(file) {
    if (!file || !resetImport()) return;
    await run(async () => {
      if (!/\.csv$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw new Error("请选择不超过 5MB 的 CSV 文件。Excel 请先另存为 CSV UTF-8。");
      const content = await file.text();
      if (content.includes("\uFFFD")) throw new Error("文件不是有效 UTF-8，请从 Excel 另存为 CSV UTF-8。");
      setText(content); setFilename(file.name); setParsed(null); parse(content);
    });
  }
  async function inspect() {
    await run(async () => {
      const rows = previewCsv(parsed, mapping), codes = rows.filter(row => row.fields && !row.error).map(row => row.fields.serial), existing = new Set();
      for (let offset = 0; offset < codes.length; offset += 500) {
        const duplicates = await rpc("check_product_import_codes", { target_company: context.companyId, codes: codes.slice(offset, offset + 500) });
        for (const code of duplicates || []) existing.add(code);
      }
      setPreview(rows.map(row => ({ ...row, duplicate: !!row.fields && existing.has(row.fields.serial.toLowerCase()) })));
      importId.current = crypto.randomUUID(); setMessage("预览完成，尚未写入产品。已有编号会跳过，不覆盖。");
    });
  }
  async function importRows() {
    if (working.current || !preview || !importId.current) return;
    const valid = preview.filter(row => row.fields && !row.error && !row.duplicate);
    const pending = valid.filter(row => !["imported","duplicate"].includes(resultRef.current[row.row_number]?.status));
    if (!pending.length || !window.confirm(`将尝试新增 ${pending.length} 项，不覆盖已有产品。继续？`)) return;
    started.current = true; stop.current = false; setImporting(true);
    await run(async () => {
      try {
        for (let offset = 0; offset < pending.length && !stop.current; offset += 100) {
          const batch = pending.slice(offset, offset + 100);
          const rows = await rpc("import_products_batch", { target_company: context.companyId, import_key: importId.current,
            entries: batch.map(row => ({ row_number: row.row_number, ...row.fields })) });
          if (!Array.isArray(rows) || rows.length !== batch.length) throw new Error("结果未确认，请保留页面并重试。");
          for (const row of rows) resultRef.current[row.row_number] = row;
          setResults({ ...resultRef.current }); setProgress(Object.values(resultRef.current).filter(row => row.status === "imported").length);
        }
        setMessage(stop.current ? "已暂停。已新增的产品保留，可继续导入。" : "本次处理完成。失败项目可在此页面重试；需改动 CSV 时重新预览。");
      } finally { setImporting(false); }
    });
  }
  function report() {
    const lines = [["CSV行号","产品编号","名称","结果","说明"], ...(preview || []).map(row => {
      const outcome = results[row.row_number];
      return [row.csv_line,row.fields?.serial || row.raw_serial || "",row.fields?.name || row.raw_name || "",row.error ? "格式错误" : row.duplicate ? "已有编号" : outcome?.status || "未处理",row.error || outcome?.message || (row.duplicate ? "已跳过，不覆盖" : "")];
    })];
    downloadFile(new File(["\uFEFF" + lines.map(row => row.map(csvCell).join(",")).join("\r\n")], "jomsales-import-results.csv", { type: "text/csv;charset=utf-8" }));
  }
  const validCount = preview?.filter(row => !row.error && !row.duplicate).length || 0;
  return <>
    <Link href={`/cloud?company=${context.companyId}`}>← 产品目录</Link><h1>目录设置与导入</h1><p>{context.name}</p>
    {error && <p role="alert" className="accountError">{error}</p>}{message && <p role="status">{message}</p>}
    <fieldset className="productFields" disabled={priceBusy||categoryBusy||tableBusy}>
    <details className="accountCard"><summary>产品编号设置</summary>
      {!settings && <button disabled={busy} onClick={readNumbers}>读取编号设置</button>}
      {numberDraft && <form onSubmit={e => { e.preventDefault(); void run(async () => {
        const row = await rpc("save_product_number_settings", { target_company: context.companyId, expected_revision: settings.revision,
          auto_number: numberDraft.automatic, number_prefix: numberDraft.prefix, number_digits: Number(numberDraft.digits), next_value: Number(numberDraft.next_number) });
        const value = Array.isArray(row) ? row[0] : row; setSettings(value); setNumberDraft(value); setDirty(false); setMessage("编号规则已保存，仅影响以后自动生成的编号。旧产品不会改变。");
      }); }}><fieldset disabled={busy}>
        <label>新增编号方式<select value={numberDraft.automatic ? "auto" : "manual"} onChange={e => { setNumberDraft({ ...numberDraft, automatic: e.target.value === "auto" }); setDirty(true); }}><option value="auto">留空自动生成，也可手动填写</option><option value="manual">必须手动填写</option></select></label>
        <label>编号前缀<input maxLength={30} value={numberDraft.prefix} onChange={e => { setNumberDraft({ ...numberDraft, prefix: e.target.value }); setDirty(true); }} /></label>
        <label>流水号位数<input type="number" required min={1} max={12} value={numberDraft.digits} onChange={e => { setNumberDraft({ ...numberDraft, digits: e.target.value }); setDirty(true); }} /></label>
        <label>下一个流水号<input type="number" required min={1} max={999999999999} value={numberDraft.next_number} onChange={e => { setNumberDraft({ ...numberDraft, next_number: e.target.value }); setDirty(true); }} /></label>
        <p>示例：{numberDraft.prefix}{String(numberDraft.next_number).padStart(Math.min(12, Math.max(1, Number(numberDraft.digits))), "0")}。允许跳号，已有编号会自动避开。</p>
        <button>保存编号规则</button><button type="button" onClick={() => { if (!dirty || window.confirm("放弃未保存的编号修改？")) void readNumbers(); }}>重新读取</button>
      </fieldset></form>}
    </details>
    <section className="accountCard"><h2>CSV 新增产品</h2>
      <p>仅新增，不覆盖已有产品；图片暂不批量导入。一次最多 10,000 项，5MB。</p>
      <button disabled={busy} onClick={() => downloadFile(new File([csvTemplate()], "jomsales-products-template.csv", { type: "text/csv;charset=utf-8" }))}>下载 CSV 模板</button>
      <label>选择 CSV 文件<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void choose(file); }} /></label>
      {text && <><p>{filename}</p><label>分隔符<select value={delimiter} disabled={busy || started.current} onChange={e => { setDelimiter(e.target.value); try { parse(text, e.target.value); } catch (err) { setParsed(null); setError(err.message); } }}><option value=",">逗号</option><option value=";">分号</option><option value={"\t"}>Tab</option></select></label></>}
      {parsed && <><h3>对应字段</h3><fieldset disabled={busy || started.current}>
        {CSV_FIELDS.map(([field,label]) => <label key={field}>{label}<select value={mapping[field] ?? -1} onChange={e => { setMapping({ ...mapping, [field]: Number(e.target.value) }); setPreview(null); importId.current = null; }}><option value={-1}>不导入此字段</option>{parsed.headers.map((header,index) => <option value={index} key={index}>{header}</option>)}</select></label>)}
      </fieldset><button disabled={busy || started.current} onClick={inspect}>预览并检查重复编号</button></>}
      {preview && <>
        <p>共 {preview.length} 行 · 可新增 {validCount} · 格式错误 {preview.filter(row => row.error).length} · 已有编号 {preview.filter(row => row.duplicate).length}</p>
        <p role="status">已确认新增 {progress} · 失败 {Object.values(results).filter(row => row.status === "failed").length} · 导入期间新增的重复编号 {Object.values(results).filter(row => row.status === "duplicate").length}</p>
        <div className="cloudButtons"><button disabled={busy || !validCount} onClick={importRows}>{started.current ? "继续／重试未完成项目" : "确认新增导入"}</button>
          {importing && <button onClick={() => { stop.current = true; }}>处理完当前批次后暂停</button>}
          <button disabled={busy} onClick={report}>下载完整检查／导入结果</button><button disabled={busy} onClick={() => { if (resetImport()) setMessage("可以修改字段对应并重新预览。"); }}>重新预览</button></div>
        <h3>预览（最多显示 20 行）</h3>
        {preview.slice(0,20).map(row => <div className="teamRow" key={row.row_number}><div><strong>CSV 第 {row.csv_line} 行 · {row.fields?.serial || row.raw_serial || "编号无效"}</strong><p>{row.fields?.name || row.raw_name} · {row.fields?.price} / {row.fields?.unit}</p><p>{row.error || (row.duplicate ? "已有编号，将跳过" : results[row.row_number]?.message || results[row.row_number]?.status || "待确认新增")}</p></div></div>)}
      </>}
    </section>
    </fieldset>
    <PriceEditor context={context} blocked={busy||priceBusy||categoryBusy} onBusyChange={setTableBusy}/>
    <PriceUpdate context={context} blocked={busy||categoryBusy||tableBusy} onBusyChange={setPriceBusy}/>
    <Categories context={context} blocked={busy||priceBusy||tableBusy} onBusyChange={setCategoryBusy}/>
  </>;
}
export default function CatalogSettings() {
  const { context, error } = useCompanyScope(true);
  return <main className="page accountPage">{error && <p role="alert" className="accountError">{error}</p>}{context ? <Editor key={`${context.userId}:${context.companyId}`} context={context} /> : <p>正在确认管理员权限… <Link href="/account">账号</Link></p>}</main>;
}
