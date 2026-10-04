"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useCompanyScope from "../use-company-scope";
import { CATALOG_KEY, QUOTATION_KEY, DETAILS_KEY, readStoredJson, validCatalog, validQuotation, validDetails } from "../storage";
import { createClient } from "../../lib/supabase/client";
import { readBrand, saveBrand } from "../../lib/supabase/workspace";
import { importProduct } from "../../lib/supabase/products";
import { importLegacyQuotation } from "../../lib/supabase/migration";
import { downloadFile } from "../share";
function Importer({ context }) {
  const [preview, setPreview] = useState(null), [brand, setBrand] = useState(null), [includeBrand, setIncludeBrand] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const generation = useRef(0), working = useRef(false);
  useEffect(() => {
    const leave = e => { if (working.current) { e.preventDefault(); e.returnValue = ""; } };
    const link = e => { if (working.current && e.target.closest?.("a[href]")) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener("beforeunload", leave); document.addEventListener("click", link, true);
    return () => { ++generation.current; window.removeEventListener("beforeunload", leave); document.removeEventListener("click", link, true); };
  }, []);
  async function inspect() {
    if (working.current) return;
    const version = generation.current; working.current = true; setBusy(true); setError("");
    try {
      const value = { products: readStoredJson(CATALOG_KEY, validCatalog, []), items: readStoredJson(QUOTATION_KEY, validQuotation, []), metadata: readStoredJson(DETAILS_KEY, validDetails, null) };
      const current = await readBrand(createClient(), context.companyId);
      if (version !== generation.current) return;
      setBrand(current); setPreview(value); setIncludeBrand(false); setMessage("只读取旧资料，尚未上传；原件不会被修改或删除。");
    } catch (err) { if (version === generation.current) setError(err.message); }
    finally { if (version === generation.current) { working.current = false; setBusy(false); } }
  }
  async function migrate() {
    if (!preview || working.current || !window.confirm(`确认导入 ${context.name}？${includeBrand ? "会替换当前公司品牌。" : "不会改变当前公司品牌。"}旧浏览器原件保留。`)) return;
    working.current = true; setBusy(true); setError(""); const version = generation.current;
    let imported = 0, skipped = 0; const failures = [];
    try {
      const client = createClient(); let currentBrand = brand;
      // Optional brand replacement is explicit and optimistic; failed brand prevents dependent import.
      if (includeBrand) currentBrand = await saveBrand(client, brand, { ...preview.metadata.company, removeLogo: !preview.metadata.company.logo });
      for (const product of preview.products) {
        if (version !== generation.current) return;
        try { (await importProduct(client, context.companyId, product)) === "imported" ? imported++ : skipped++; }
        catch (err) { failures.push(`${product.serial}：${err.message}`); }
        if (version === generation.current) setMessage(`正在导入：新增 ${imported}，跳过 ${skipped}，失败 ${failures.length}。`);
      }
      if (preview.items.length) {
        try { (await importLegacyQuotation(client, context, preview, currentBrand)) === "imported" ? imported++ : skipped++; }
        catch (err) { failures.push(`旧报价：${err.message}`); }
      }
      if (version !== generation.current) return;
      setBrand(currentBrand); setIncludeBrand(false);
      setMessage(`导入完成：新增 ${imported}，跳过 ${skipped}，失败 ${failures.length}。旧原件仍保留，成功项目不会重复导入。`);
      setError(failures.join("；"));
    } catch (err) { if (version === generation.current) setError(err.message); }
    finally { if (version === generation.current) { working.current = false; setBusy(false); } }
  }
  return <>
    <Link href={`/cloud?company=${context.companyId}`}>← 公司产品目录</Link><h1>迁移旧浏览器资料</h1>
    <p className="notice">管理员专用。目标公司：{context.name}。仅在存有旧资料的原浏览器执行。本地模式已退出日常使用；不会自动上传、清空或覆盖旧原件。</p>
    <button disabled={busy} onClick={inspect}>读取并预览旧资料</button>
    {error && <p className="accountError" role="alert">{error}</p>}<p role="status">{message}</p>
    {preview && <section className="accountCard">
      <p>产品 {preview.products.length} 项；报价 {preview.items.length ? "1 份" : "0 份"}；旧品牌 {preview.metadata?.company.name || "无"}。</p>
      <ul>{preview.products.slice(0,20).map(p => <li key={p.id}>{p.serial} · {p.name}</li>)}</ul>
      <p>相同来源产品和报价会跳过；相同产品编号但不同来源报冲突，不覆盖云端。旧报价归当前管理员；未存日期的旧报价标记为 2000-01-01，导入后可修改。</p>
      {preview.metadata?.company.name && <label><input type="checkbox" checked={includeBrand} disabled={busy} onChange={e => setIncludeBrand(e.target.checked)} />明确替换公司云端品牌（当前：{brand?.name}）。旧报价使用导入时的云端品牌快照。</label>}
      <div className="cloudButtons">
        <button disabled={busy} onClick={() => downloadFile(new File([JSON.stringify(preview,null,2)], "SalesGo-legacy-backup.json", { type: "application/json" }))}>下载旧资料备份</button>
        <button disabled={busy || (!preview.products.length && !preview.items.length && !includeBrand)} onClick={migrate}>{busy ? "正在导入…" : "确认导入公司云端"}</button>
      </div>
    </section>}
  </>;
}
export default function Migration() {
  const { context, error } = useCompanyScope(true);
  return <main className="page accountPage">{error && <p role="alert">{error}</p>}{context ? <Importer key={`${context.userId}:${context.companyId}`} context={context} /> : <p>正在确认管理员权限… <Link href="/account">公司账号</Link></p>}</main>;
}
