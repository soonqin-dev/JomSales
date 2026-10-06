// Public DTO: never spread internal product/quotation/company rows into a response.
export const CATALOG_TOKEN = /^[0-9a-f]{64}$/;
export const CATALOG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CATALOG_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache",
  "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff"
};
export function publicCatalogDto(data) {
  if (!data || !Array.isArray(data.items) || !/^\+[1-9][0-9]{7,14}$/.test(data.whatsapp)) throw new Error("Invalid catalog response");
  return { company_name: data.company_name, seller_name: data.seller_name, whatsapp: data.whatsapp,
    categories:Array.isArray(data.categories)?data.categories.filter(c=>typeof c==='string'&&c.length<=80):[],
    expires_at: data.expires_at, total: data.total, has_more: data.has_more === true,
    cursor: data.cursor ? { created_at: data.cursor.created_at, id: data.cursor.id } : null,
    items: data.items.slice(0, 50).map(p => ({ id: p.id, serial: p.serial, name: p.name,
      tags: Array.isArray(p.tags) ? p.tags : [], unit: p.unit, category: p.category,
      description: p.description, is_service: p.is_service === true, has_image: p.has_image === true })) };
}
export function catalogSearchParams(search) {
  const query = search.get("q") || "", created = search.get("after_created"), id = search.get("after_id");
  if (query.length > 240 || !!created !== !!id || (id && (!CATALOG_UUID.test(id) || created.length > 40 || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:/.test(created) || !Number.isFinite(Date.parse(created))))) throw new Error("Invalid search");
  const category=search.has('category')?search.get('category'):null;if(category!==null&&category.length>80)throw new Error('Invalid category');
  return { search_text: query.trim(), after_created: created || null, after_id: id || null,category_filter:category };
}
export function catalogInquiryUrl(phone, product) {
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return "";
  const text = `你好，我想询价。\n产品编号：${product.serial}\n产品名称：${product.name}`;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(text)}`;
}
export function catalogImagePath(path, productId) {
  return typeof path === "string" && CATALOG_UUID.test(productId)
    && new RegExp(`^[0-9a-f-]{36}/${productId}/[0-9a-f-]{36}\\.(webp|jpg|png)$`).test(path);
}
