import { moneyToCents, MAX_UNIT_PRICE } from "../../app/quotation-utils";

export const PRODUCT_BUCKET = "salesgo-products";
const COLUMNS = "id,company_id,serial,name,tags,price,image_path,source_key,revision,created_at,deleted_at";
function fail(error) { if (error) throw new Error(error.message || "云端操作失败，请重试。"); }

export function productFields(item) {
  const cents = moneyToCents(item.price);
  const tags = item.tags || [];
  if (!item.serial?.trim() || item.serial.trim().length > 120 || !item.name?.trim() || item.name.trim().length > 240) throw new Error("产品编号需为 1–120 字符，名称需为 1–240 字符。");
  if (cents === null || cents / 100 > MAX_UNIT_PRICE) throw new Error("产品价格无效，请填写非负金额，最多两位小数。");
  if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== "string") || tags.join(",").length > 2000) throw new Error("最多 20 个标签，标签总长度不能超过 2,000 字符。");
  return { serial: item.serial.trim(), name: item.name.trim(), tags, price: (cents / 100).toFixed(2) };
}

export async function signedProducts(client, rows) {
  const paths = [...new Set(rows.map(row => row.image_path).filter(Boolean))];
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
  return rows.map(row => ({ ...row, price: Number(row.price).toFixed(2), image: images.get(row.image_path) || "",
    imageError: row.image_path && (missing.has(row.image_path) || !images.has(row.image_path)) ? "照片暂时无法读取，请刷新或重新上传。" : ""
  }));
}

export async function readProducts(client, companyId) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from("products").select(COLUMNS)
      .eq("company_id", companyId).is("deleted_at", null)
      .order("created_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 499);
    fail(error);
    rows.push(...data);
    if (data.length < 500) break;
  }
  return signedProducts(client, rows);
}

async function uploadImage(client, companyId, id, image) {
  if (!/^data:image\/(webp|jpeg|png);base64,/.test(image)) throw new Error("请重新上传 JPG、PNG 或 WebP 产品图片。");
  const blob = await (await fetch(image)).blob();
  if (blob.size > 5 * 1024 * 1024) throw new Error("处理后的图片超过 5MB，请选择较小图片。");
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
  const fields = productFields(item);
  const id = previous?.id || item.id || crypto.randomUUID();
  let newPath = null;
  let imagePath = previous?.image_path || null;
  if (!item.image) imagePath = previous?.imageError ? previous.image_path : null;
  else if (!previous || item.image !== previous.image) imagePath = newPath = await uploadImage(client, companyId, id, item.image);
  try {
    const query = previous
      ? client.from("products").update({ ...fields, image_path: imagePath })
        .eq("id", id).eq("company_id", companyId).eq("revision", previous.revision).is("deleted_at", null)
      : client.from("products").insert({ ...fields, id, company_id: companyId, image_path: imagePath, source_key: null });
    const { data, error } = await query.select(COLUMNS).maybeSingle();
    fail(error);
    if (!data) throw new Error("产品已被其他设备修改或删除，或你没有权限。请刷新后重新编辑。");
    const warning = previous?.image_path && previous.image_path !== imagePath ? await cleanImage(client, previous.image_path) : "";
    return { row: data, warning };
  } catch (err) {
    if (newPath) await cleanImage(client, newPath);
    throw err;
  }
}

export async function deleteProduct(client, companyId, item) {
  const { data, error } = await client.from("products").update({ deleted_at: new Date().toISOString(), image_path: null })
    .eq("company_id", companyId).eq("id", item.id).eq("revision", item.revision).is("deleted_at", null).select("id").maybeSingle();
  fail(error);
  if (!data) throw new Error("产品已被修改或删除，或你没有权限。请刷新后重试。");
  return cleanImage(client, item.image_path);
}
