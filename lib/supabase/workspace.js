import { lineCents, quotationTotals, newQuotationDetails } from "../../app/quotation-utils";

export const BRAND_BUCKET = "salesgo-branding";
export const QUOTE_COLUMNS = "id,company_id,created_by,creator_email,creator_name,status,deleted_at,number,quote_date,customer_name,customer_phone,customer_company,customer_email,customer_address,customer_id,validity_days,payment_terms,confirmed_at,paid_at,total_amount,notes,discount,items,company_snapshot,source_key,revision,updated_at,created_at";
const fail = error => { if (error) throw new Error(error.message || "云端请求失败"); };

export async function signedBrand(client, company) {
  const brand = { ...company, logo: "", logoError: "" };
  if (!company.logo_path) return brand;
  try {
    const { data, error } = await client.storage.from(BRAND_BUCKET).createSignedUrl(company.logo_path, 300);
    fail(error);
    if (!data?.signedUrl) throw new Error("没有可用的 Logo 链接");
    brand.logo = data.signedUrl;
  } catch (err) { brand.logoError = `公司 Logo 无法读取：${err.message}。请刷新或联系管理员。`; }
  return brand;
}

export async function readBrand(client, companyId) {
  const result = await client.from("companies").select("id,name,contact,logo_path,brand_revision").eq("id", companyId).maybeSingle();
  fail(result.error);
  if (!result.data) throw new Error("公司资料不可用或权限已停用。");
  return signedBrand(client, result.data);
}

async function cleanupLogo(client, path) {
  if (!path) return "";
  try {
    const result = await client.storage.from(BRAND_BUCKET).remove([path]);
    if (result.error || !result.data?.length) return "未使用的 Logo 未能清理；已被公司或历史报价引用的 Logo 会保留。";
  } catch { return "Logo 清理未确认，请联系管理员。"; }
  return "";
}

export async function saveBrand(client, previous, draft) {
  if (!draft.name.trim() || draft.name.trim().length > 120 || draft.contact.length > 180) throw new Error("公司名称为 1–120 字符，联系方式最多 180 字符。");
  let logoPath = previous.logo_path, uploaded = null;
  if (draft.removeLogo || (!draft.logo && !previous.logoError)) logoPath = null;
  if (draft.logo?.startsWith("data:")) {
    if (!/^data:image\/(webp|jpeg|png);base64,/.test(draft.logo)) throw new Error("Logo 需为 JPG、PNG 或 WebP。");
    const blob = await (await fetch(draft.logo)).blob();
    if (blob.size > 1048576) throw new Error("处理后的 Logo 不能超过 1MB。");
    const ext = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[blob.type];
    uploaded = logoPath = `${previous.id}/${crypto.randomUUID()}.${ext}`;
    try {
      const upload = await client.storage.from(BRAND_BUCKET).upload(logoPath, blob, { upsert: false, contentType: blob.type });
      fail(upload.error);
    } catch (err) { await cleanupLogo(client, uploaded); throw err; }
  }
  try {
    const result = await client.rpc("save_company_brand", { target_company: previous.id, company_name: draft.name.trim(), company_contact: draft.contact,
      new_logo_path: logoPath, expected_revision: previous.brand_revision });
    fail(result.error);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) throw new Error("公司资料保存结果未确认。");
    // Preserve historical logos. They may be referenced by saved quotations.
    return signedBrand(client, row);
  } catch (err) {
    // A committed but lost response must not cause deletion of a referenced logo.
    if (uploaded) await cleanupLogo(client, uploaded);
    throw new Error(`保存未确认：${err.message}。请先重新读取公司资料核对，再重试；表单未存到本地。`);
  }
}

export function quotePayload(draft) {
  const { items, details } = draft;
  if (!Array.isArray(items) || items.length > 200 || items.some(item => !item || lineCents(item) === null ||
    [[item.product?.id,240],[item.product?.serial,120],[item.product?.name,240]].some(([value,max]) => typeof value !== "string" || !value.trim() || value.length > max)) ||
    new Set(items.map(item => item.product.id)).size !== items.length) throw new Error("报价最多 200 项，产品快照、数量和单价必须有效且不重复。");
  if ((draft.row?.revision && !details.number?.trim()) || (details.number || "").length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(details.date)) throw new Error("报价编号或日期无效。");
  if (details.customerName.length > 120 || details.phone.length > 40 || details.notes.length > 3000) throw new Error("客户或备注资料过长。");
  const validity = details.validityDays === "" || details.validityDays == null ? null : Number(details.validityDays);
  if ((validity !== null && (!Number.isInteger(validity) || validity < 1 || validity > 365)) || (details.paymentTerms || "").length > 1500 ||
    (details.customerCompany || "").length > 120 || (details.email || "").length > 254 || (details.address || "").length > 1000 ||
    (details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email))) throw new Error("有效期、条款或客户资料无效。");
  const totals = quotationTotals(items, details.discount);
  if (totals.total === null) throw new Error("折扣必须有效且不能超过小计。");
  if (items.some(item => (item.product.unit !== undefined && (typeof item.product.unit !== "string" || !item.product.unit.trim() || item.product.unit.length > 30)) ||
    (item.product.description !== undefined && (typeof item.product.description !== "string" || item.product.description.length > 2000)) ||
    (item.product.is_service !== undefined && typeof item.product.is_service !== "boolean"))) throw new Error("项目单位或说明无效。");
  return { quote_date: details.date, customer_name: details.customerName, customer_phone: details.phone,
    customer_company: details.customerCompany || "", customer_email: details.email || "", customer_address: details.address || "", customer_id: details.customerId || null,
    validity_days: validity, payment_terms: details.paymentTerms || "",
    notes: details.notes, discount: (totals.discount / 100).toFixed(2),
    items: items.map(item => ({ product: { id: item.product.id, serial: item.product.serial, name: item.product.name,
      ...(item.product.unit !== undefined ? { unit: item.product.unit } : {}),
      ...(item.product.description !== undefined ? { description: item.product.description } : {}),
      ...(item.product.is_service !== undefined ? { is_service: item.product.is_service } : {}),
      ...(item.product.temporary === true ? { temporary: true } : {}) }, quantity: item.quantity, unitPrice: item.unitPrice })) };
}

export async function quoteDraft(client, row) {
  return { row, items: row.items.map(item => ({ ...item, lineTotal: lineCents(item) / 100 })),
    details: { number: row.number, date: row.quote_date, customerName: row.customer_name, phone: row.customer_phone, notes: row.notes, discount: String(row.discount),
      customerCompany: row.customer_company || "", email: row.customer_email || "", address: row.customer_address || "", customerId: row.customer_id || null,
      validityDays: row.validity_days == null ? "" : String(row.validity_days), paymentTerms: row.payment_terms || "" },
    company: await signedBrand(client, row.company_snapshot), dirty: false };
}

export async function readQuotation(client, context, quoteId = null) {
  if (!quoteId) return null;
  const query = client.from("quotations").select(QUOTE_COLUMNS).eq("company_id", context.companyId).eq("id", quoteId).is("deleted_at", null);
  const result = await query.maybeSingle(); fail(result.error);
  if (quoteId && !result.data) throw new Error("报价不存在或没有访问权限。");
  return result.data ? quoteDraft(client, result.data) : null;
}

export function newDraft(company, defaults = {}) {
  return { row: { id: crypto.randomUUID(), revision: 0, status: "pending" }, items: [], details: newQuotationDetails(defaults), company, dirty: false };
}

export function duplicateDraft(saved, company, defaults = {}) {
  const draft = newDraft(company, defaults);
  return { ...draft, copiedFrom: saved.details.number, items: saved.items.map(line => ({ ...line, product: { ...line.product } })),
    details: { ...saved.details, number: "", date: draft.details.date, customerId: null }, dirty: true };
}

export async function readQuotationDefaults(client, companyId) {
  const result = await client.rpc("get_quotation_defaults", { target_company: companyId }); fail(result.error); return result.data;
}

export async function saveQuotation(client, context, draft, sourceKey = null) {
  if (sourceKey) throw new Error("不再接受旧浏览器报价导入；历史云端记录会保留。");
  const payload = quotePayload(draft), id = draft.row.id;
  try {
    const query = draft.row.revision
      ? client.from("quotations").update(payload).eq("company_id", context.companyId).eq("id", id).eq("revision", draft.row.revision).is("deleted_at", null)
      : null;
    const result = query ? await query.select(QUOTE_COLUMNS).maybeSingle() : await client.rpc("create_quotation", { target_company: context.companyId, target_quote: id, payload });
    fail(result.error);
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) throw new Error("报价已被其他设备修改，或公司权限已改变。");
    return quoteDraft(client, row);
  } catch (err) {
    // Recover only a matching committed payload, never overwrite a newer edit.
    const confirm = await client.from("quotations").select(QUOTE_COLUMNS).eq("company_id", context.companyId).eq("id", id).is("deleted_at", null).maybeSingle();
    if (!confirm.error && confirm.data) {
      const normalized = await quoteDraft(client, confirm.data);
      if (JSON.stringify(quotePayload(normalized)) === JSON.stringify(payload)) return normalized;
    }
    throw new Error(`${err.message} 请先核对云端记录再重试；没有保存到本地。`);
  }
}

export async function listQuotations(client, companyId, trash = false, {search='',status='all',cursor=null}={}) {
  const result=await client.rpc('search_company_quotations',{target_company:companyId,search_text:search.trim(),filter_status:status,in_trash:trash,after_updated:cursor?.updated_at || null,after_id:cursor?.id || null});
  fail(result.error);if(!Array.isArray(result.data?.items))throw new Error('报价列表结果无效，请确认已执行收尾 SQL。');return result.data;
}

export async function manageQuotation(client, companyId, row, action) {
  if (!["pending", "success", "paid", "trash", "restore"].includes(action)) throw new Error("无效的报价操作。");
  const result = await client.rpc("manage_quotation", { target_company: companyId, target_quote: row.id, expected_revision: row.revision, action });
  fail(result.error);
  const value = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!value?.id) throw new Error("报价操作结果未确认，请刷新列表核对后再重试。");
  return value;
}
