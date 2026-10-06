import { jsPDF } from "jspdf";
import { formatMoney, lineCents, moneyToCents, quotationTotals } from "./quotation-utils";
import { loadImage } from "./images";

// Render with browser fonts so Chinese names and notes do not require a large bundled font.
// Only this export module loads jsPDF, after the salesperson taps Generate PDF.
export async function createQuotationPdf({ items, details, company }) {
  const totals = quotationTotals(items, details.discount);
  if (!items.length || totals.total === null || !details.customerName.trim() ||
      !company.name.trim() || !details.date || !details.number.trim()) {
    throw new Error("请先填写完整、有效的报价资料。");
  }
  await document.fonts.ready;
  let logo = null;
  if (company.logo) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(company.logo) && !/^https?:\/\//.test(company.logo)) throw new Error("公司 Logo 无效，请重新上传。");
    try { logo = await loadImage(company.logo); } catch { throw new Error("公司 Logo 无法显示，请刷新公司品牌链接或重新上传。"); }
  }

  const width = 794;
  const height = 1123;
  const left = 44;
  const right = width - left;
  const bottom = 1025;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法生成 PDF，请换用 Safari 或 Chrome 重试。");
  ctx.scale(2, 2);
  const pages = [];
  let y;

  function font(size = 12, weight = 400) {
    ctx.font = `${weight} ${size}px Arial, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "left";
    ctx.fillStyle = "#111827";
  }

  function wrapped(text, maxWidth) {
    const lines = [];
    for (const paragraph of String(text).split("\n")) {
      let line = "";
      for (const character of Array.from(paragraph)) {
        if (line && ctx.measureText(line + character).width > maxWidth) {
          const split = line.lastIndexOf(" ");
          if (split > 0) {
            lines.push(line.slice(0, split));
            line = line.slice(split + 1) + character;
          } else {
            lines.push(line);
            line = character;
          }
        } else line += character;
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  function text(value, x, baseline, { size = 12, weight = 400, color = "#111827", align = "left" } = {}) {
    font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(String(value), x, baseline);
  }

  function fitted(value, x, baseline, maxWidth, size = 12) {
    font(size);
    while (ctx.measureText(String(value)).width > maxWidth && size > 7) font(--size);
    ctx.textAlign = "right";
    ctx.fillText(String(value), x, baseline);
  }

  function rule(atY) {
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, atY);
    ctx.lineTo(right, atY);
    ctx.stroke();
  }

  function header() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    let nameX = left;
    if (logo) {
      const scale = Math.min(72 / logo.naturalWidth, 64 / logo.naturalHeight);
      ctx.drawImage(logo, left, 34, logo.naturalWidth * scale, logo.naturalHeight * scale);
      nameX += 88;
    }
    font(22, 700);
    const nameLines = wrapped(company.name, 450 - nameX);
    nameLines.forEach((line, index) => text(line, nameX, 56 + index * 28, { size: 22, weight: 700 }));
    text("QUOTATION", right, 58, { size: 24, weight: 700, align: "right", color: "#2563eb" });
    font(11);
    const numberLines = wrapped(details.number, 260);
    numberLines.forEach((line, index) => text(line, right, 82 + index * 16, { size: 11, align: "right" }));
    text(`Date: ${details.date}`, right, 100 + (numberLines.length - 1) * 16,
      { size: 11, align: "right", color: "#6b7280" });
    y = Math.max(138, 82 + nameLines.length * 28, 126 + numberLines.length * 16);
    rule(y - 18);
  }

  function finishPage() {
    rule(1050);
    font(10);
    const contact = wrapped(company.contact || company.name, 590);
    contact.slice(0, 4).forEach((line, index) => text(line, left, 1070 + index * 12,
      { size: 10, color: "#6b7280" }));
    text(`Page ${pages.length + 1}`, right, 1070, { size: 10, color: "#6b7280", align: "right" });
    pages.push(canvas.toDataURL("image/jpeg", 0.95));
  }

  function nextPage() {
    finishPage();
    header();
  }

  function tableHeader() {
    ctx.fillStyle = "#eff6ff";
    ctx.fillRect(left, y, right - left, 34);
    text("Product Code", left + 8, y + 22, { size: 10, weight: 700 });
    text("Product Name", 164, y + 22, { size: 10, weight: 700 });
    text("Qty", 514, y + 22, { size: 10, weight: 700, align: "right" });
    text("Unit Price (RM)", 630, y + 22, { size: 10, weight: 700, align: "right" });
    text("Amount (RM)", right - 8, y + 22, { size: 10, weight: 700, align: "right" });
    y += 34;
  }

  header();
  text("CUSTOMER", left, y, { size: 11, weight: 700, color: "#2563eb" });
  y += 22;
  font(15);
  for (const line of wrapped(details.customerName, right - left)) {
    if (y + 20 > bottom) nextPage();
    text(line, left, y, { size: 15 });
    y += 22;
  }
  font(12);
  for (const line of wrapped(`Phone: ${details.phone || "—"}`, right - left)) {
    if (y + 20 > bottom) nextPage();
    text(line, left, y, { color: "#6b7280" });
    y += 18;
  }
  y += 20;
  for (const value of [details.customerCompany, details.email, details.address]) {
    if (!value) continue;
    font(12);
    for (const line of wrapped(value, right-left)) { if (y+20>bottom) nextPage(); text(line,left,y,{color:"#6b7280"});y+=18; }
  }
  if (details.validityDays) {
    const expires = new Date(`${details.date}T00:00:00Z`);
    expires.setUTCDate(expires.getUTCDate()+Number(details.validityDays));
    if(y+20>bottom)nextPage();
    text(`Valid until: ${expires.toISOString().slice(0,10)} (${details.validityDays} days)`,left,y,{size:11,color:"#6b7280"});y+=22;
  }
  if (y + 78 > bottom) nextPage();
  tableHeader();

  items.forEach((item, index) => {
    font(11);
    const codes = wrapped(item.product.serial, 98);
    font(12);
    const names = wrapped([item.product.name, item.product.unit ? `单位：${item.product.unit}` : "", item.product.description || ""].filter(Boolean).join("\n"), 290);
    const count = Math.max(codes.length, names.length);
    let offset = 0;
    while (offset < count) {
      const needed = Math.max(44, (count - offset) * 18 + 20);
      // Move an ordinary row intact to the next page; split exceptionally long rows.
      if (needed > bottom - y && needed <= bottom - 200) {
        nextPage();
        tableHeader();
      }
      if (bottom - y < 44) {
        nextPage();
        tableHeader();
      }
      const availableLines = Math.max(1, Math.floor((bottom - y - 20) / 18));
      const take = Math.min(count - offset, availableLines);
      const rowHeight = Math.max(44, take * 18 + 20);
      ctx.fillStyle = index % 2 ? "#f8fafc" : "#ffffff";
      ctx.fillRect(left, y, right - left, rowHeight);
      for (let line = 0; line < take; line++) {
        if (codes[offset + line]) text(codes[offset + line], left + 8, y + 22 + line * 18, { size: 11 });
        if (names[offset + line]) text(names[offset + line], 164, y + 22 + line * 18);
      }
      if (!offset) {
        fitted(item.quantity, 514, y + 22, 52);
        fitted((moneyToCents(item.unitPrice) / 100).toLocaleString("en-MY", {
          minimumFractionDigits: 2, maximumFractionDigits: 2 }), 630, y + 22, 108);
        fitted((lineCents(item) / 100).toLocaleString("en-MY", {
          minimumFractionDigits: 2, maximumFractionDigits: 2 }), right - 8, y + 22, 104);
      }
      y += rowHeight;
      rule(y);
      offset += take;
      if (offset < count) {
        nextPage();
        tableHeader();
      }
    }
  });

  if (y + 145 > bottom) nextPage();
  y += 28;
  text("Subtotal", 460, y, { size: 13 });
  fitted(formatMoney(totals.subtotal), right - 8, y, 178, 13);
  y += 28;
  text("Discount", 460, y, { size: 13 });
  fitted(formatMoney(totals.discount), right - 8, y, 178, 13);
  y += 20;
  ctx.fillStyle = "#eff6ff";
  ctx.fillRect(448, y, right - 448, 42);
  text("TOTAL", 460, y + 27, { size: 15, weight: 700 });
  fitted(formatMoney(totals.total), right - 8, y + 27, 178, 17);
  y += 72;

  for (const [label,value] of [["PAYMENT TERMS",details.paymentTerms || ""],["NOTES",details.notes]]) {
    if (!value.trim()) continue;
    if (y + 44 > bottom) nextPage();
    text(label, left, y, { size: 11, weight: 700, color: "#2563eb" });
    y += 22;
    font(12);
    const notes = wrapped(value, right - left);
    for (const line of notes) {
      if (y + 18 > bottom) {
        nextPage();
        text(`${label} (continued)`, left, y, { size: 11, weight: 700, color: "#2563eb" });
        y += 22;
      }
      text(line, left, y);
      y += 18;
    }
    y+=18;
  }
  finishPage();

  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.setProperties({ title: `Quotation ${details.number}`, author: company.name,
    subject: `Quotation for ${details.customerName}` });
  pages.forEach((page, index) => {
    if (index) pdf.addPage();
    pdf.addImage(page, "JPEG", 0, 0, 210, 297);
  });
  // Release the drawing buffer after export; the draft keeps only the PDF file.
  canvas.width = 0;
  canvas.height = 0;
  const filename = details.number.replace(/[^\w-]/g, "_").slice(0, 100);
  return new File([pdf.output("blob")], `${filename}.pdf`, { type: "application/pdf" });
}
