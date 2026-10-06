import { moneyToCents, MAX_UNIT_PRICE } from "../../app/quotation-utils";

export const PRODUCT_BUCKET = "salesgo-products";
const COLUMNS = "id,company_id,serial,name,tags,price,image_path,thumbnail_path,image_hash,unit,category,description,is_service,source_key,revision,created_at,deleted_at";
function fail(error) {
  if (!error) return;
  let message = error.message || "云端操作失败，请重试。";
  if (/Automatic numbering disabled/i.test(message)) message = "公司已关闭自动编号，请填写产品编号。";
  else if (/product quota reached/i.test(message)) message = "公司产品额度已满，请联系 JomSales 负责人调整配套。";
  else if (/reserved by another/i.test(message)) message = "编号正被另一个新增请求使用，请换一个编号。";
  else if (/products_company_serial_idx/i.test(message)) message = "此公司已有相同产品编号，不会覆盖原产品。";
  throw Object.assign(new Error(message), { code: error.code });
}
function sameProductFields(row, fields) {
  return Object.entries(fields).every(([key,value]) => key === "price" ? moneyToCents(row[key]) === moneyToCents(value) : JSON.stringify(row[key]) === JSON.stringify(value));
}

export function productFields(item) {
  const cents = moneyToCents(item.price);
  const tags = item.tags || [];
  if (!item.serial?.trim() || item.serial.trim().length > 120 || !item.name?.trim() || item.name.trim().length > 240) throw new Error("产品编号需为 1–120 字符，名称需为 1–240 字符。");
  if (cents === null || cents / 100 > MAX_UNIT_PRICE) throw new Error("产品价格无效，请填写非负金额，最多两位小数。");
  if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== "string") || tags.join(",").length > 2000) throw new Error("最多 20 个标签，标签总长度不能超过 2,000 字符。");
  const unit = (item.unit || "件").trim(), category = item.category || "", description = item.description || "";
  if (!unit || unit.length > 30 || typeof category !== "string" || category.length > 80 || typeof description !== "string" || description.length > 2000 || (item.is_service !== undefined && typeof item.is_service !== "boolean")) throw new Error("单位最多 30 字符，分类最多 80 字符，说明最多 2,000 字符。");
  return { serial: item.serial.trim(), name: item.name.trim(), tags, price: (cents / 100).toFixed(2), unit, category: category.trim(), description, is_service: item.is_service === true };
}

export async function signedProducts(client, rows, { full = false } = {}) {
  const imagePath = row => full ? row.image_path : row.thumbnail_path || row.image_path;
  const paths = [...new Set(rows.map(imagePath).filter(Boolean))];
  const images = new Map();
  const missing = new Set();
  // Bound signing batches so large catalogs do not create oversized requests.
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { data, error } = await client.storage.from(PRODUCT_BUCKET).createSignedUrls(paths.slice(offset, offset + 100), 300);
    fail(error);
    for (const result of data || []) {
      if (result.error || !result.signedUrl) missing.add(result.path);
      else images.set(result.path, result.signedUrl);
    }
  }
  return rows.map(row => ({ ...row, price: Number(row.price).toFixed(2), image: images.get(imagePath(row)) || "",
    imageError: imagePath(row) && (missing.has(imagePath(row)) || !images.has(imagePath(row))) ? "照片暂时无法读取，请刷新或重新上传。" : ""
  }));
}

export async function readProducts(client, companyId, { query = "", cursor = null,category = null } = {}) {
  const { data, error } = await client.rpc("search_company_products", { target_company: companyId, search_text: query.trim(),
    after_created: cursor?.created_at || null, after_id: cursor?.id || null,category_filter:category });
  fail(error);
  if (!data || !Array.isArray(data.items)) throw new Error("目录读取结果无效，请确认已执行第二批迁移。");
  return { ...data, items: await signedProducts(client, data.items) };
}

export async function readProductDetail(client, companyId, id) {
  const { data, error } = await client.from("products").select(COLUMNS).eq("company_id", companyId).eq("id", id).is("deleted_at", null).maybeSingle();
  fail(error);
  if (!data) throw new Error("产品不存在或公司权限不可用。");
  return (await signedProducts(client, [data], { full: true }))[0];
}

async function imageBlob(image) {
  if (!/^data:image\/(webp|jpeg|png);base64,/.test(image)) throw new Error("请重新上传 JPG、PNG 或 WebP 产品图片。");
  const blob = await (await fetch(image)).blob();
  if (blob.size > 5 * 1024 * 1024) throw new Error("处理后的图片超过 5MB，请选择较小图片。");
  return blob;
}

async function uploadImage(client, companyId, id, image) {
  const blob = await imageBlob(image);
  const ext = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[blob.type];
  const path = `${companyId}/${id}/${crypto.randomUUID()}.${ext}`;
  try {
    const { error } = await client.storage.from(PRODUCT_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
    fail(error);
  } catch (err) {
    await cleanImage(client, path);
    throw err;
  }
  return path;
}

async function cleanImage(client, path) {
  if (!path) return "";
  try {
    // RLS prevents deleting an object still referenced by a live product,
    // including after an ambiguous network failure on a committed write.
    const { data, error } = await client.storage.from(PRODUCT_BUCKET).remove([path]);
    if (error || !data?.length) return "部分旧图片未能清理，产品资料已保存；请联系管理员检查存储。";
  } catch { return "图片清理未完成，请联系管理员检查存储。"; }
  return "";
}

export async function saveProduct(client, companyId, item, previous = null) {
  const id = previous?.id || item.id || crypto.randomUUID();
  let serial = item.serial?.trim();
  if (!serial && !previous) {
    const result = await client.rpc("reserve_product_number", { target_company: companyId, target_product: id }); fail(result.error); serial = result.data;
  }
  const fields = productFields({ ...item, serial });
  let newPath = null, newThumb = null;
  let imagePath = previous?.image_path || null;
  let thumbnailPath = previous?.thumbnail_path || null, imageHash = previous?.image_hash || null;
  const hasNewImage = !!item.image && (!previous || item.image !== previous.image);
  if (hasNewImage) {
    const digest = await crypto.subtle.digest("SHA-256", await (await imageBlob(item.image)).arrayBuffer());
    imageHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  } else if (!item.image && !previous?.imageError) { imagePath = null; thumbnailPath = null; imageHash = null; }
  // An insert retry must not upload another photo or overwrite a newer edit.
  if (!previous) {
    const existing = await client.from("products").select(COLUMNS).eq("company_id", companyId).eq("id", id).is("deleted_at", null).maybeSingle();
    fail(existing.error);
    if (existing.data) {
      if (sameProductFields(existing.data, fields) && (existing.data.image_hash || null) === imageHash) return { row: existing.data, warning: "已确认上次保存成功。" };
      throw new Error("此新增请求已有不同的云端记录，请刷新核对，不会覆盖。");
    }
  }
  try {
    if (hasNewImage) {
      imagePath = newPath = await uploadImage(client, companyId, id, item.image);
      thumbnailPath = item.thumbnail?.startsWith("data:") ? newThumb = await uploadImage(client, companyId, id, item.thumbnail) : null;
    }
    const query = previous
      ? client.from("products").update({ ...fields, image_path: imagePath, thumbnail_path: thumbnailPath, image_hash: imageHash })
        .eq("id", id).eq("company_id", companyId).eq("revision", previous.revision).is("deleted_at", null)
      : client.from("products").insert({ ...fields, id, company_id: companyId, image_path: imagePath, thumbnail_path: thumbnailPath, image_hash: imageHash, source_key: null });
    const { data, error } = await query.select(COLUMNS).maybeSingle();
    fail(error);
    if (!data) throw new Error("产品已被其他设备修改或删除，或你没有权限。请刷新后重新编辑。");
    const oldPaths = [previous?.image_path, previous?.thumbnail_path].filter(path => path && path !== imagePath && path !== thumbnailPath);
    const warning = (await Promise.all([...new Set(oldPaths)].map(path => cleanImage(client, path)))).join("");
    return { row: data, warning };
  } catch (err) {
    const confirmed = await client.from("products").select(COLUMNS).eq("company_id", companyId).eq("id", id).is("deleted_at", null).maybeSingle();
    if (!confirmed.error && confirmed.data && sameProductFields(confirmed.data, fields)
      && confirmed.data.image_path === imagePath && (confirmed.data.thumbnail_path || null) === thumbnailPath && (confirmed.data.image_hash || null) === imageHash) return { row: confirmed.data, warning: "已核对云端保存结果。" };
    if (newPath) await cleanImage(client, newPath);
    if (newThumb) await cleanImage(client, newThumb);
    throw err;
  }
}

export async function deleteProduct(client, companyId, item) {
  const { data, error } = await client.from("products").update({ deleted_at: new Date().toISOString(), image_path: null, thumbnail_path: null, image_hash: null })
    .eq("company_id", companyId).eq("id", item.id).eq("revision", item.revision).is("deleted_at", null).select("id").maybeSingle();
  fail(error);
  if (!data) throw new Error("产品已被修改或删除，或你没有权限。请刷新后重试。");
  return (await Promise.all([...new Set([item.image_path, item.thumbnail_path].filter(Boolean))].map(path => cleanImage(client, path)))).join("");
}
