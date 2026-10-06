export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40 * 1000 * 1000;
const MAX_IMAGE_SIDE = 1600;

export async function loadImage(source) {
  const image = new Image();
  if (/^https?:\/\//i.test(source)) image.crossOrigin = "anonymous";
  image.src = source;
  await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("无效图片");
  return image;
}

export function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (!blob || !blob.size) reject(new Error("图片处理失败，请尝试较小的图片或重新打开页面。"));
        else if (blob.type !== type) reject(new Error("浏览器无法生成所需的图片格式。"));
        else resolve(blob);
      }, type, quality);
    } catch {
      reject(new Error("图片处理失败，请尝试较小的图片或重新打开页面。"));
    }
  });
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败，请重新选择。"));
    reader.readAsDataURL(blob);
  });
}

export async function prepareUploadImage(file, { maxSide = MAX_IMAGE_SIDE } = {}) {
  const accepted = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const type = (file.type || "").toLowerCase();
  const isHeic = /^image\/(heic|heif)(-sequence)?$/.test(type) || /\.(heic|heif)$/i.test(file.name);
  if (!isHeic && !accepted.includes(type) && !(!type && /\.(jpe?g|png|webp)$/i.test(file.name))) {
    throw new Error("请选择 JPG、PNG、WebP 或手机拍摄的 HEIC 图片。");
  }
  if (file.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 12MB，请选择较小的图片。");
  const source = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  try {
    let image;
    try { image = await loadImage(source); }
    catch {
      throw new Error(isHeic
        ? "此浏览器无法读取 HEIC/HEIF 照片，请先导出为 JPG，或使用手机截图后上传。"
        : "无法读取这张图片，请尝试较小的 JPG、PNG 图片或手机截图。");
    }
    if (image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
      throw new Error("图片分辨率过大，请先缩小至 4000 万像素以内。");
    }
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器无法处理图片，请换用 Safari 或 Chrome。");
    // Modern browser decoding applies EXIF orientation; keep the transparent canvas for PNG alpha.
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob;
    try {
      blob = await canvasBlob(canvas, "image/webp", 0.82);
    } catch {
      // Canvas may return PNG when WebP encoding is unavailable (including on Safari).
      // Keep potentially transparent sources as PNG; ordinary photos can use JPEG.
      const isJpeg = /^image\/jpe?g$/.test(type) || (!type && /\.jpe?g$/i.test(file.name));
      const fallbackType = isJpeg || isHeic ? "image/jpeg" : "image/png";
      try {
        blob = await canvasBlob(canvas, fallbackType, 0.82);
      } catch (err) {
        if (fallbackType === "image/png") throw err;
        blob = await canvasBlob(canvas, "image/png");
      }
    }
    return await blobDataUrl(blob);
  } finally {
    URL.revokeObjectURL(source);
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (line && ctx.measureText(line + character).width > maxWidth) {
        const space = line.lastIndexOf(" ");
        if (space > 0) {
          lines.push(line.slice(0, space));
          line = line.slice(space + 1) + character;
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
