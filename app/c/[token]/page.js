import PublicCatalog, { InvalidCatalog } from "./PublicCatalog";
import { CATALOG_TOKEN } from "../../../lib/catalog-public";
export const dynamic = "force-dynamic";
export const metadata = { title: "JomSales · 产品目录", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ params }) {
  const { token } = await params;
  return CATALOG_TOKEN.test(token) ? <PublicCatalog token={token} /> : <InvalidCatalog />;
}
