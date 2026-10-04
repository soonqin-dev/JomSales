export const CATALOG_KEY = "salesgo_catalog_v1";
export const QUOTATION_KEY = "salesgo_quotation_v1";
export const DETAILS_KEY = "salesgo_quotation_details_v1";
export const DEFAULT_COMPANY = { name: "", contact: "", logo: "" };

const legacyKeys = {
  [CATALOG_KEY]: "autoparts_catalog_vercel_demo_v1",
  [QUOTATION_KEY]: "autoparts_quotation_v1",
  [DETAILS_KEY]: "autoparts_quotation_details_v1"
};

export function validCatalog(value) {
  return Array.isArray(value) && value.every(item => item && typeof item.id === "string" &&
    item.id && typeof item.serial === "string" && typeof item.name === "string" &&
    (typeof item.price === "string" || Number.isFinite(item.price)) &&
    (item.tags === undefined || (Array.isArray(item.tags) && item.tags.every(tag => typeof tag === "string"))) &&
    (item.image === undefined || typeof item.image === "string"));
}

export function validQuotation(value) {
  return Array.isArray(value) && value.every(item => item?.product?.id &&
    typeof item.product.serial === "string" && typeof item.product.name === "string" &&
    Number.isSafeInteger(item.quantity) && item.quantity >= 1 &&
    Number.isFinite(item.unitPrice) && item.unitPrice >= 0 && Number.isFinite(item.lineTotal));
}

export function validDetails(value) {
  return ["customerName", "phone", "number", "date", "notes", "discount"]
    .every(key => typeof value?.details?.[key] === "string") &&
    ["name", "contact", "logo"].every(key => typeof value?.company?.[key] === "string");
}

export function readStoredJson(key, validate, fallback) {
  let raw = localStorage.getItem(key);
  const legacy = raw === null ? localStorage.getItem(legacyKeys[key]) : null;
  if (raw === null && legacy === null) return fallback;
  raw = raw ?? legacy;
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error("资料内容无法读取。原资料未被覆盖，请检查浏览器存储后重试。"); }
  if (!validate(value)) throw new Error("资料格式无效。原资料未被覆盖，请检查浏览器存储后重试。");
  if (legacy !== null) {
    // Retire only the old unused placeholder. Preserve a company's entered branding.
    if (key === DETAILS_KEY && value.company.name === "AutoParts" &&
        !value.company.contact && !value.company.logo) {
      value = { ...value, company: { ...value.company, name: "" } };
    }
    // Read-only legacy migration. Never write, rename or clear browser business data.
  }
  return value;
}
