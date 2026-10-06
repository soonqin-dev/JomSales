import { canvasBlob, loadImage, wrapCanvasText } from "./images";
import { moneyToCents } from "./quotation-utils";

export async function createProductCard(item, company) {
  if (moneyToCents(item.price) === null) throw new Error("产品价格无效，请编辑产品填写有效价格。");
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
    ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", sans-serif`;
  };
  font(24, 700);
  const companyLines = company.name ? wrapCanvasText(ctx, company.name, available - (logo ? 90 : 0)) : [];
  const companyHeight = logo || companyLines.length ? Math.max(64, companyLines.length * 34) + 30 : 0;
  font(36, 700);
  const nameLines = wrapCanvasText(ctx, item.name, available);
  font(24);
  const codeLines = wrapCanvasText(ctx, item.serial, available);
  font(24);
  const tagLines = item.tags?.length ? wrapCanvasText(ctx, item.tags.join(" · "), available) : [];
  const unitLines = item.unit ? wrapCanvasText(ctx, `单位：${item.unit}${item.is_service ? " · 服务" : ""}`, available) : [];
  const photoHeight = photo ? 500 : 180;
  canvas.height = padding * 2 + companyHeight + photoHeight + 40 + nameLines.length * 48 +
    44 + codeLines.length * 34 + 108 + unitLines.length * 34 + (tagLines.length ? 32 + tagLines.length * 34 : 0);
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
    function lines(values, x, size, lineHeight, weight = 400, color = "#111827") {
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
      lines(companyLines, padding + (logo ? 90 : 0), 24, 34, 700);
      y = start + companyHeight;
    }
    ctx.fillStyle = "#f4f6f8";
    ctx.fillRect(padding, y, available, photoHeight);
    if (photo) {
      const scale = Math.min((available - 24) / photo.naturalWidth, (photoHeight - 24) / photo.naturalHeight);
      const width = photo.naturalWidth * scale;
      const height = photo.naturalHeight * scale;
      ctx.drawImage(photo, padding + (available - width) / 2, y + (photoHeight - height) / 2, width, height);
    } else {
      font(22, 600);
      ctx.fillStyle = "#9ca3af";
      ctx.textAlign = "center";
      ctx.fillText("NO PHOTO", canvas.width / 2, y + photoHeight / 2 - 14);
      ctx.textAlign = "left";
    }
    y += photoHeight + 40;
    lines(nameLines, padding, 36, 48, 700);
    y += 18;
    lines(["PRODUCT CODE / 产品编号"], padding, 16, 26, 600, "#6b7280");
    lines(codeLines, padding, 24, 34);
    y += 28;
    lines([`RM ${Number(item.price).toLocaleString("en-MY", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    })}`], padding, 48, 64, 700, "#2563eb");
    y += 16;
    if (unitLines.length) lines(unitLines, padding, 24, 34, 400, "#4b5563");
    if (tagLines.length) {
      lines(["TAGS / 标签"], padding, 16, 32, 600, "#6b7280");
      lines(tagLines, padding, 24, 34, 400, "#4b5563");
    }
    const blob = await canvasBlob(canvas, "image/jpeg", 0.92);
    const code = item.serial.replace(/[^\w-]/g, "_").slice(0, 60) || "product";
    return new File([blob], `JomSales-${code}-product-card.jpg`, { type: "image/jpeg" });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
