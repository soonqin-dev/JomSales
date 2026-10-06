export function newCatalogLinkRequest(companyId, label, selectedIds = null) {
  if (typeof label !== "string" || label.length > 120) throw new Error("链接名称最多 120 字符。");
  if (selectedIds !== null && (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 1000)) throw new Error("请挑选 1–1000 项产品。");
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  return { target_company: companyId, request_id: crypto.randomUUID(), link_token: token,
    link_label: label.trim(), selected_ids: selectedIds === null ? null : [...new Set(selectedIds)].sort() };
}
export async function createCatalogLink(client, request) {
  const result = await client.rpc("create_catalog_link", request);
  if (result.error) throw Object.assign(new Error(catalogLinkError(result.error.message)), { code: result.error.code });
  return Array.isArray(result.data) ? result.data[0] : result.data;
}
export function catalogLinkError(message = "") {
  if (/work WhatsApp/i.test(message)) return "请先到个人设置保存姓名和含国家码的工作 WhatsApp 号码。";
  if (/No public products/i.test(message)) return "暂无允许公开的产品，请管理员先开启产品公开权限。";
  if (/selected products/i.test(message)) return "部分已选产品已删除或不再公开，请重新读取并检查选择。";
  if (/Too many active/i.test(message)) return "有效链接已达 100 个，请先撤销不用的链接。";
  return message || "操作失败，请重试。";
}
export async function listCatalogLinks(client, companyId, cursor = null) {
  let query = client.from("catalog_links").select("id,company_id,created_by,token,label,scope,product_ids,seller_name,whatsapp,created_at,expires_at,revoked_at")
    .eq("company_id", companyId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(51);
  if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { items: data.slice(0, 50), hasMore: data.length > 50, cursor: data.length ? { created_at: data[Math.min(49, data.length - 1)].created_at, id: data[Math.min(49, data.length - 1)].id } : null };
}
