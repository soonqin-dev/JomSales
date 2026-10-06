import { catalogReader } from "../../../../../../lib/supabase/public-catalog-server";
import { CATALOG_TOKEN, CATALOG_UUID, CATALOG_HEADERS, catalogInquiryUrl } from "../../../../../../lib/catalog-public";
export const dynamic = "force-dynamic";
export async function GET(_request, { params }) {
  const { token, product } = await params;
  const fail = status => new Response("此产品或目录链接已失效，请联系销售员。", { status, headers: { ...CATALOG_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  if (!CATALOG_TOKEN.test(token) || !CATALOG_UUID.test(product)) return fail(404);
  try {
    const result = await catalogReader().rpc("public_catalog_inquiry", { link_token: token, target_product: product });
    if (result.error) return fail(result.error.code === "42501" ? 404 : 503);
    const location = catalogInquiryUrl(result.data.whatsapp, result.data);
    if (!location) return fail(404);
    return new Response(null, { status: 302, headers: { ...CATALOG_HEADERS, Location: location } });
  } catch { return fail(503); }
}
