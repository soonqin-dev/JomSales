"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { readBrand, readQuotation, newDraft, duplicateDraft, readQuotationDefaults, saveQuotation, signedBrand } from "../lib/supabase/workspace";
import { MAX_QUANTITY, MAX_UNIT_PRICE, quantityToMillis, moneyToCents, lineCents } from "./quotation-utils";
import { useConfirm } from "./ui";

export const MAX_QUOTE_LINES = 200;

// The draft lives in page memory only (never browser storage). It is held by the
// (member) layout, so it survives client-side navigation and is lost on reload.
export default function useCloudQuotation(context) {
  const [draft, setDraft] = useState(null);
  const [brand, setBrand] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const current = useRef(null), liveBrand = useRef(null), liveDefaults = useRef({}), generation = useRef(0), working = useRef(false);
  const confirm = useConfirm();
  function replace(value) { current.current = value; setDraft(value); }
  const hasContent = () => !!(current.current?.dirty || current.current?.items?.length);

  function clearHandoff() {
    const url = new URL(window.location.href);
    if (!["quote", "new", "duplicate"].some(key => url.searchParams.has(key))) return;
    ["quote", "new", "duplicate"].forEach(key => url.searchParams.delete(key));
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }

  async function load(id, copying) {
    const version = ++generation.current;
    setLoading(true); setError("");
    try {
      const client = createClient();
      const [company, saved, defaults] = await Promise.all([readBrand(client, context.companyId), readQuotation(client, context, id), readQuotationDefaults(client, context.companyId)]);
      if (version !== generation.current) return false;
      liveBrand.current = company; liveDefaults.current = defaults; setBrand(company);
      replace(copying && saved ? duplicateDraft(saved, company, defaults) : saved || newDraft(company, defaults));
      setMessage(copying ? "已复制为新报价，请确认价格和条款。保存时分配新编号，不覆盖原报价。" : "");
      return true;
    } catch (err) {
      if (version === generation.current) setError(`报价或公司资料读取失败：${err.message}。当前内容没有清空。`);
      return false;
    } finally { if (version === generation.current) setLoading(false); }
  }

  // QTE.RELOAD: re-read the saved quote (or brand/defaults for a new one).
  async function reload() {
    if (working.current) return false;
    if (current.current?.dirty && !(await confirm({ title: "重新读取？", message: "重新读取会放弃未保存的修改。", confirmLabel: "放弃并重新读取", danger: true }))) return false;
    return load(current.current?.row.revision ? current.current.row.id : null, false);
  }

  // QTL.SELECT / duplicate: replaces the current quote after D.QUOTE_REPLACE.
  async function open(id, { duplicate = false } = {}) {
    if (working.current) return false;
    if (current.current?.row.id === id && !duplicate && !current.current.dirty) return true;
    if (hasContent() && !(await confirm({ title: "替换当前报价？", message: "当前报价还没完成。打开另一张报价会放弃这些内容。", cancelLabel: "留在这里", confirmLabel: "放弃并打开", danger: true }))) return false;
    return load(id, duplicate);
  }

  useEffect(() => {
    // One-time URL handoff from old bookmarks: /cloud?quote=<id> or ?duplicate=<id>.
    const params = new URLSearchParams(window.location.search);
    const copying = params.get("duplicate");
    void load(params.get("quote") || copying, !!copying).then(clearHandoff);
    const leave = event => { if (current.current?.dirty || working.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    let renewId = 0;
    async function renew() {
      if (working.current || !current.current) return;
      const id = ++renewId, version = generation.current;
      try {
        const [company, defaults] = await Promise.all([readBrand(createClient(), context.companyId), readQuotationDefaults(createClient(), context.companyId)]);
        const value = current.current;
        const snapshot = value.row.revision ? await signedBrand(createClient(), value.company) : company;
        if (id !== renewId || version !== generation.current || working.current || value !== current.current) return;
        liveBrand.current = company; liveDefaults.current = defaults; setBrand(company); replace({ ...value, company: snapshot });
      } catch (err) { if (id === renewId && version === generation.current) setError(`公司品牌续期失败：${err.message}。请刷新确认权限。`); }
    }
    const timer = setInterval(renew, 120000); window.addEventListener("focus", renew);
    return () => { ++generation.current; ++renewId; clearInterval(timer); window.removeEventListener("focus", renew); window.removeEventListener("beforeunload", leave); };
  }, []);

  function edit(task) {
    if (!current.current || working.current) return;
    replace({ ...task(current.current), dirty: true }); setMessage("");
  }

  async function save(value = current.current) {
    if (!value || working.current) throw new Error("报价资料尚未就绪或正在保存。");
    working.current = true; setBusy(true); setError(""); setMessage("");
    const version = generation.current;
    try {
      const result = await saveQuotation(createClient(), context, value);
      if (version !== generation.current) throw new Error("账号或公司已改变，请在原公司核对保存结果。");
      replace(result);
      return result;
    } catch (err) {
      if (version === generation.current) { replace({ ...value, dirty: true }); setError(`保存失败：${err.message}`); }
      throw err;
    } finally { working.current = false; setBusy(false); }
  }

  // CAT.ADD_QUOTE / PRD.ADD_QUOTE: same product merges into one line, quantity +1.
  function add(product) {
    const value = current.current;
    if (!value || working.current) return { ok: false, reason: "报价还在读取，请稍候。" };
    if (moneyToCents(product.price) === null || Number(product.price) > MAX_UNIT_PRICE) return { ok: false, reason: "这个产品价格有误，请先修正。" };
    const existing = value.items.find(line => line.product.id === product.id);
    if (existing && (quantityToMillis(existing.quantity) === null || quantityToMillis(existing.quantity) + 1000 > MAX_QUANTITY * 1000)) return { ok: false, reason: "这一行的数量已达上限。" };
    if (!existing && value.items.length >= MAX_QUOTE_LINES) return { ok: false, reason: `报价最多 ${MAX_QUOTE_LINES} 行。` };
    const items = existing ? value.items.map(line => {
      if (line.product.id !== product.id) return line;
      const next = { ...line, quantity: (quantityToMillis(line.quantity) + 1000) / 1000 };
      return { ...next, lineTotal: lineCents(next) / 100 };
    }) : [...value.items, { product: { id: product.id, serial: product.serial, name: product.name, unit: product.unit || "件", description: product.description || "", is_service: product.is_service === true }, quantity: 1, unitPrice: Number(product.price), lineTotal: Number(product.price) }];
    edit(prev => ({ ...prev, items }));
    return { ok: true, merged: !!existing };
  }

  // QTE.NEW_QUOTE: D.QUOTE_REPLACE only when there is something to lose.
  async function startNew() {
    if (!current.current || working.current) return false;
    if (hasContent() && !(await confirm({ title: "新建报价？", message: "当前报价的未保存内容会被放弃，已保存的报价仍在报价记录里。", confirmLabel: "放弃并新建", danger: true }))) return false;
    reset(); return true;
  }

  function addTemporary(fields) {
    const price = moneyToCents(fields.price), quantity = quantityToMillis(fields.quantity), name = fields.name.trim(), unit = fields.unit.trim();
    if (!name || name.length > 240 || !unit || unit.length > 30 || price === null || price / 100 > MAX_UNIT_PRICE || quantity === null || (fields.description || "").length > 2000) throw new Error("请填写有效的名称、单位、数量和单价。");
    if (!current.current || working.current || current.current.items.length >= MAX_QUOTE_LINES) throw new Error(`报价未就绪或已达 ${MAX_QUOTE_LINES} 行上限。`);
    const line = { product: { id: `temp-${crypto.randomUUID()}`, serial: "临时项目", name, unit, description: fields.description || "", is_service: false, temporary: true }, quantity: quantity / 1000, unitPrice: price / 100 };
    edit(prev => ({ ...prev, items: [...prev.items, { ...line, lineTotal: lineCents(line) / 100 }], temporaryDraft: null }));
  }

  function reset() {
    ++generation.current;
    replace(newDraft(liveBrand.current, liveDefaults.current)); setError(""); setMessage(""); setLoading(false);
    clearHandoff();
  }

  // Successful download/share: start a blank quote.
  function complete(id) {
    if (working.current || current.current?.dirty || current.current?.row.id !== id) return false;
    reset(); return true;
  }

  // Discard silently (company switch / logout already confirmed by the caller).
  function discard() { if (!working.current) reset(); }

  return { ...draft, brand, loading, busy, error, message,
    ready: !loading && !!draft, save, add, addTemporary, startNew, reload, open, complete, discard,
    markDirty: () => edit(prev => prev),
    clearError: () => setError(""),
    setTemporaryDraft: value => edit(prev => ({ ...prev, temporaryDraft: value })),
    setItems: value => edit(prev => ({ ...prev, items: typeof value === "function" ? value(prev.items) : value })),
    setDetails: value => edit(prev => ({ ...prev, details: typeof value === "function" ? value(prev.details) : value })) };
}
