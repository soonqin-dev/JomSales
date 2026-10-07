// Platform recycle bin client helpers (docs/deletion-spec.md). Every call is re-checked
// by the database: platform owner only, MFA when required.
import { quoteDraft } from "./workspace";
import { zipStore } from "../zip";
import { customersCsv, productsCsv, quotationItemsCsv, quotationsCsv, safeFileName } from "../backup";

const MESSAGES = [
  [/Platform administrator/i, "需要平台权限并完成双重验证，请刷新后再试。"],
  [/name does not match/i, "公司名称不一致，请照着输入完整名称。"],
  [/e-mail does not match/i, "邮箱不一致，请照着输入完整邮箱。"],
  [/Platform owner accounts/i, "平台负责人账号不能删除。"],
  [/primary administrator role/i, "这个账号是公司的正管理员，请先在公司设置里换人，再删除。"],
  [/already deleted/i, "这个账号已经在回收箱里。"],
  [/not in the recycle bin/i, "它不在回收箱里，可能已被恢复或已永久删除。请刷新。"],
  [/Company unavailable|Account unavailable/i, "资料已改变，请刷新后再试。"]
];
export function deletionError(error) {
  const message = error?.message || "";
  for (const [pattern, text] of MESSAGES) if (pattern.test(message)) return text;
  return `操作未完成：${message || "请检查网络后重试"}`;
}

async function rpc(client, name, args) {
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(deletionError(result.error));
  return result.data;
}

export const trashCompany = (client, id, name) => rpc(client, "platform_trash_company", { target_company: id, confirm_name: name });
export const restoreCompany = (client, id) => rpc(client, "platform_restore_company", { target_company: id });
export const purgeCompany = (client, id, name) => rpc(client, "platform_purge_company", { target_company: id, confirm_name: name });
export const listAccounts = (client, search, offset, scope) => rpc(client, "platform_list_accounts", { search_text: search, page_offset: offset, list_scope: scope });
export const trashAccount = (client, id, email) => rpc(client, "platform_trash_account", { target_user: id, confirm_email: email });
export const restoreAccount = (client, id) => rpc(client, "platform_restore_account", { target_user: id });
export const purgeAccount = (client, id, email) => rpc(client, "platform_purge_account", { target_user: id, confirm_email: email });

export async function exportAll(client, companyId, kind, stopped = () => false) {
  const rows = [];
  for (let offset = 0; !stopped(); offset += 200) {
    const page = await rpc(client, "platform_company_export", { target_company: companyId, kind, page_offset: offset });
    rows.push(...page);
    if (page.length < 200) break;
  }
  return rows;
}

const bytes = async blob => new Uint8Array(await blob.arrayBuffer());
const text = value => new TextEncoder().encode(value);

// Builds ZIP parts: part 1 holds the CSVs, PDFs follow in batches so no single
// download grows too large. renderPdf(draft) => File is injected by the page.
export async function buildCompanyBackup(client, company, { renderPdf, includePdf = true, batchSize = 80, onProgress = () => {}, stopped = () => false } = {}) {
  onProgress({ stage: "data", done: 0, total: 0 });
  const [quotes, customers, products] = await Promise.all([
    exportAll(client, company.id, "quotations", stopped), exportAll(client, company.id, "customers", stopped), exportAll(client, company.id, "products", stopped)
  ]);
  const base = safeFileName(company.name, "company"), day = new Date().toISOString().slice(0, 10);
  const parts = [];
  let current = [
    { name: "报价汇总.csv", data: text(quotationsCsv(quotes)) },
    { name: "报价明细.csv", data: text(quotationItemsCsv(quotes)) },
    { name: "客户.csv", data: text(customersCsv(customers)) },
    { name: "产品.csv", data: text(productsCsv(products)) }
  ];
  const failures = [];
  if (includePdf) {
    for (let index = 0; index < quotes.length && !stopped(); index++) {
      onProgress({ stage: "pdf", done: index, total: quotes.length });
      const row = quotes[index];
      try {
        const file = await renderPdf(await quoteDraft(client, row));
        current.push({ name: `PDF/${safeFileName(row.number, row.id)}${row.deleted_at ? "-回收站" : ""}.pdf`, data: await bytes(file) });
      } catch (err) { failures.push([row.number, err.message || "PDF 生成失败"]); }
      if (current.length >= batchSize) { parts.push(current); current = []; }
    }
  }
  if (failures.length) current.push({ name: "PDF生成失败.csv", data: text("﻿编号,原因\r\n" + failures.map(([n, m]) => `"${String(n).replaceAll('"', '""')}","${String(m).replaceAll('"', '""')}"`).join("\r\n")) });
  if (current.length) parts.push(current);
  onProgress({ stage: "zip", done: quotes.length, total: quotes.length });
  const files = parts.map((entries, i) => new File([zipStore(entries)], `JomSales-备份-${base}-${day}${parts.length > 1 ? `-第${i + 1}部分` : ""}.zip`, { type: "application/zip" }));
  return { files, counts: { quotations: quotes.length, customers: customers.length, products: products.length, pdfFailures: failures.length } };
}

// Removes the company's Storage files through the Storage API (never SQL), 100 per call.
export async function removeCompanyFiles(client, companyId, onProgress = () => {}) {
  let removed = 0;
  for (let round = 0; round < 50; round++) {
    const names = await rpc(client, "platform_company_files", { target_company: companyId });
    if (!names.length) return removed;
    const byBucket = names.reduce((map, row) => { (map[row.bucket_id] ||= []).push(row.name); return map; }, {});
    let progressed = 0;
    for (const [bucket, list] of Object.entries(byBucket)) {
      for (let offset = 0; offset < list.length; offset += 100) {
        const result = await client.storage.from(bucket).remove(list.slice(offset, offset + 100));
        if (result.error) throw new Error(`文件清理失败：${result.error.message}`);
        progressed += result.data?.length || 0;
      }
    }
    removed += progressed; onProgress(removed);
    if (!progressed) throw new Error("文件清理没有进展，请检查 Storage 权限后重试。");
  }
  return removed;
}
