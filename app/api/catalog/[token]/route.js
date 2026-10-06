import { catalogReader } from "../../../../lib/supabase/public-catalog-server";
import { CATALOG_TOKEN, CATALOG_HEADERS, publicCatalogDto, catalogSearchParams } from "../../../../lib/catalog-public";
export const dynamic = "force-dynamic";
export async function GET(request, { params }) {
  const { token } = await params;
  const reply = (data, status = 200) => Response.json(data, { status, headers: CATALOG_HEADERS });
  if (!CATALOG_TOKEN.test(token)) return reply({ error: "此目录链接已失效或不存在。" }, 404);
  let query;
  try { query = catalogSearchParams(new URL(request.url).searchParams); }
  catch { return reply({ error: "搜索条件无效。" }, 400); }
  try {
    const result = await catalogReader().rpc("read_public_catalog", { link_token: token, ...query });
    if (result.error) return reply({ error: result.error.code === "42501" ? "此目录链接已失效或不存在。" : "目录暂时无法读取，请稍后重试。" }, result.error.code === "42501" ? 404 : 503);
    return reply(publicCatalogDto(result.data));
  } catch { return reply({ error: "目录暂时无法读取，请稍后重试。" }, 503); }
}
