export const MAX_QUANTITY = 999999;
export const MAX_UNIT_PRICE = 9999999.99;

export function quantityToMillis(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const amount = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_QUANTITY * 1000 ? amount : null;
}

export function moneyToCents(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

export function lineCents(item) {
  const cents = moneyToCents(item.unitPrice);
  const quantity = quantityToMillis(item.quantity);
  if (cents === null || item.unitPrice > MAX_UNIT_PRICE ||
      quantity === null) return null;
  // Exact fixed-point multiplication and half-up rounding, matching SQL numeric.
  const total = (BigInt(cents) * BigInt(quantity) + 500n) / 1000n;
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

export function quotationTotals(items, discount) {
  let subtotal = 0;
  for (const item of items) {
    const total = lineCents(item);
    if (total === null) return { subtotal: null, discount: null, total: null };
    subtotal += total;
  }
  if (!Number.isSafeInteger(subtotal)) return { subtotal: null, discount: null, total: null };
  const discountCents = moneyToCents(discount === "" ? 0 : discount);
  return {
    subtotal,
    discount: discountCents,
    total: discountCents === null || discountCents > subtotal ? null : subtotal - discountCents
  };
}

export function formatMoney(cents) {
  return cents === null ? "—" : `RM ${(cents / 100).toLocaleString("en-MY", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })}`;
}

export function newQuotationDetails() {
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")].join("-");
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(value => String(value).padStart(2, "0")).join("");
  const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
  return { customerName: "", phone: "", number: `Q-${date.replaceAll("-", "")}-${time}-${suffix}`,
    date, notes: "", discount: "0" };
}
