import { newDraft, saveQuotation, quotePayload, QUOTE_COLUMNS } from "./workspace";

// Stable company/user/source identity makes retries safe, even after a lost response.
export async function legacyQuoteIdentity(context, draft) {
  const payload = quotePayload(draft);
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, "0")).join("");
  const sourceKey = `legacy-quote:${await digest(JSON.stringify(payload))}`;
  const hash = await digest(`${context.companyId}:${context.userId}:${sourceKey}`);
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  return { id, sourceKey };
}
export async function importLegacyQuotation(client, context, legacy, brand) {
  const draft = { ...newDraft(brand), items: legacy.items, details: legacy.metadata?.details || newDraft(brand).details };
  // Old versions without metadata receive a stable rather than random quote number.
  if (!legacy.metadata) { draft.details.number = "Legacy quotation"; draft.details.date = "2000-01-01"; }
  const { id, sourceKey } = await legacyQuoteIdentity(context, draft);
  const existing = await client.from("quotations").select(QUOTE_COLUMNS).eq("company_id", context.companyId).eq("created_by", context.userId).eq("source_key", sourceKey).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return "skipped";
  await saveQuotation(client, context, { ...draft, row: { id, revision: 0 } }, sourceKey);
  return "imported";
}
