import { canvasBlob, loadImage, wrapCanvasText } from "./images";

// Customer-facing product card JPG. It never shows a price or the goods/service type
// (daily-flow-spec §3.1); prices stay in the internal catalog, quotes and PDFs.
export async function createProductCard(item, company, contact = {}) {
  await document.fonts.ready;
  const [photo, logo] = await Promise.all([
    item.image ? loadImage(item.image).catch(() => { throw new Error("产品照片无法读取，请编辑产品重新上传。"); }) : null,
    company.logo ? loadImage(company.logo).catch(() => { throw new Error("公司 Logo 无法读取，请在公司资料中重新上传。"); }) : null
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法生成产品卡片。");
  const padding = 54;
  const available = canvas.width - padding * 2;
  const font = (size, weight = 400) => {
    ctx.font = `${weight} ${size}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans CJK SC", sans-serif`;
  };
  font(24, 700);
  const companyLines = company.name ? wrapCanvasText(ctx, company.name, available - (logo ? 90 : 0)) : [];
  const companyHeight = logo || companyLines.length ? Math.max(64, companyLines.length * 34) + 30 : 0;
  font(36, 700);
  const nameLines = wrapCanvasText(ctx, item.name, available);
  font(24);
  const codeLines = wrapCanvasText(ctx, item.serial, available);
  const unitLines = item.unit ? wrapCanvasText(ctx, `单位：${item.unit}`, available) : [];
  const groupLines = [item.category, ...(item.tags || [])].filter(Boolean).length
    ? wrapCanvasText(ctx, [item.category, ...(item.tags || [])].filter(Boolean).join(" · "), available) : [];
  const contactText = [contact.name, contact.whatsapp].filter(Boolean).join("  ·  WhatsApp ");
  const contactLines = contactText ? wrapCanvasText(ctx, contactText, available - 40) : [];
  const photoHeight = photo ? 640 : 360;
  canvas.height = padding * 2 + companyHeight + photoHeight + 40 + nameLines.length * 48 + 18 +
    26 + codeLines.length * 34 + 20 + unitLines.length * 34 + (groupLines.length ? 12 + groupLines.length * 34 : 0) +
    (contactLines.length ? 40 + 40 + contactLines.length * 34 : 0);
  if (canvas.height > 16000) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error("产品文字过长，请缩短名称或标签后再分享。");
  }

  try {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = "top";
    let y = padding;
    function lines(values, x, size, lineHeight, weight = 400, color = "#161a32") {
      font(size, weight);
      ctx.fillStyle = color;
      values.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
      y += values.length * lineHeight;
    }
    if (companyHeight) {
      if (logo) {
        const scale = Math.min(64 / logo.naturalWidth, 64 / logo.naturalHeight);
        ctx.drawImage(logo, padding, y, logo.naturalWidth * scale, logo.naturalHeight * scale);
      }
      const start = y;
      lines(companyLines, padding + (logo ? 90 : 0), 24, 34, 700, "#252b53");
      y = start + companyHeight;
    }
    ctx.fillStyle = photo ? "#f6f7fb" : "#d9d9d9";
    ctx.fillRect(padding, y, available, photoHeight);
    if (photo) {
      const scale = Math.min((available - 24) / photo.naturalWidth, (photoHeight - 24) / photo.naturalHeight);
      const width = photo.naturalWidth * scale;
      const height = photo.naturalHeight * scale;
      ctx.drawImage(photo, padding + (available - width) / 2, y + (photoHeight - height) / 2, width, height);
    }
    y += photoHeight + 40;
    lines(nameLines, padding, 36, 48, 700);
    y += 18;
    lines(["PRODUCT CODE / 产品编号"], padding, 16, 26, 600, "#6b7280");
    lines(codeLines, padding, 24, 34);
    y += 20;
    if (unitLines.length) lines(unitLines, padding, 24, 34, 400, "#4b5563");
    if (groupLines.length) { y += 12; lines(groupLines, padding, 24, 34, 400, "#252b53"); }
    if (contactLines.length) {
      y += 40;
      ctx.fillStyle = "#e0e2ed";
      ctx.fillRect(padding, y - 20, available, 1);
      lines(["CONTACT / 联系人"], padding, 16, 40, 600, "#6b7280");
      lines(contactLines, padding, 24, 34, 600, "#0b8200");
    }
    const blob = await canvasBlob(canvas, "image/jpeg", 0.92);
    const code = String(item.serial || "").replace(/[^\w-]/g, "_").slice(0, 60) || "product";
    return new File([blob], `JomSales-${code}-product-card.jpg`, { type: "image/jpeg" });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
