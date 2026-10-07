// Company backup CSVs for the platform recycle bin (docs/deletion-spec.md §3).
// Cells that look like spreadsheet formulas are prefixed with ' (CSV injection guard).
export function csvCell(value) {
  let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function toCsv(header, rows) {
  return "﻿" + [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const STATUS = { pending: "待确认", success: "已成交", paid: "已收款" };

export function quotationsCsv(quotes) {
  return toCsv(["编号", "日期", "状态", "客户", "客户公司", "电话", "邮箱", "地址", "折扣", "总额", "建立者", "建立者邮箱", "备注", "付款条款", "有效天数", "已在报价回收站", "建立时间", "更新时间"],
    quotes.map(q => [q.number, q.quote_date, STATUS[q.status] || q.status, q.customer_name, q.customer_company, q.customer_phone, q.customer_email, q.customer_address,
      q.discount, q.total_amount, q.creator_name, q.creator_email, q.notes, q.payment_terms, q.validity_days, q.deleted_at ? "是" : "", q.created_at, q.updated_at]));
}

export function quotationItemsCsv(quotes) {
  const rows = [];
  for (const q of quotes) for (const [index, line] of (q.items || []).entries()) {
    rows.push([q.number, index + 1, line.product?.serial, line.product?.name, line.product?.unit || "", line.quantity, line.unitPrice, line.product?.temporary ? "临时项目" : "", line.product?.description || ""]);
  }
  return toCsv(["报价编号", "行号", "产品编号", "名称", "单位", "数量", "单价", "类型", "说明"], rows);
}

export function customersCsv(customers) {
  return toCsv(["姓名", "公司", "电话", "邮箱", "地址", "状态", "建立时间"],
    customers.map(c => [c.name, c.company, c.phone, c.email, c.address, c.active === false ? "已停用" : "有效", c.created_at]));
}

export function productsCsv(products) {
  return toCsv(["编号", "名称", "价格", "单位", "分类", "标签", "说明", "已删除", "建立时间"],
    products.map(p => [p.serial, p.name, p.price, p.unit, p.category, (p.tags || []).join(", "), p.description, p.deleted_at ? "是" : "", p.created_at]));
}

export function safeFileName(value, fallback = "file") {
  return String(value || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || fallback;
}
