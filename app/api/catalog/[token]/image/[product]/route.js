import { catalogReader, catalogImageReader } from "../../../../../../lib/supabase/public-catalog-server";
import { CATALOG_TOKEN, CATALOG_UUID, CATALOG_HEADERS, catalogImagePath } from "../../../../../../lib/catalog-public";
export const dynamic = "force-dynamic";
export async function GET(request, { params }) {
  const { token, product } = await params;
  const fail = status => new Response(null, { status, headers: CATALOG_HEADERS });
  if (!CATALOG_TOKEN.test(token) || !CATALOG_UUID.test(product)) return fail(404);
  try {
    const reader = catalogReader(), args = { link_token: token, target_product: product, full_image: new URL(request.url).searchParams.get("full") === "1" };
    const authorized = await reader.rpc("public_catalog_image", args);
    if (authorized.error) return fail(authorized.error.code === "42501" ? 404 : 503);
    if (!catalogImagePath(authorized.data, product)) return fail(404);
    const image = await catalogImageReader().storage.from("salesgo-products").download(authorized.data);
    if (image.error || !image.data) return fail(503);
    if (image.data.size > 5242880 || !["image/webp", "image/jpeg", "image/png"].includes(image.data.type)) return fail(404);
    // Check again after download: revocation or a changed product/photo must not return stale bytes.
    const stillAllowed = await reader.rpc("public_catalog_image", args);
    if (stillAllowed.error || stillAllowed.data !== authorized.data) return fail(404);
    return new Response(image.data, { headers: { ...CATALOG_HEADERS, "Content-Type": image.data.type, "Content-Disposition": "inline" } });
  } catch { return fail(503); }
}
