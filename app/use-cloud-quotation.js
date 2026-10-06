"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { readBrand, readQuotation, newDraft, duplicateDraft, readQuotationDefaults, saveQuotation, signedBrand } from "../lib/supabase/workspace";
import { MAX_QUANTITY, MAX_UNIT_PRICE, quantityToMillis, moneyToCents, lineCents } from "./quotation-utils";

export default function useCloudQuotation(context) {
  const [draft, setDraft] = useState(null);
  const [brand, setBrand] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const current = useRef(null), liveBrand = useRef(null), liveDefaults = useRef({}), generation = useRef(0), working = useRef(false);
  function replace(value) { current.current = value; setDraft(value); }

  async function reload() {
    if (working.current) return;
    if (current.current?.dirty && !window.confirm("重新读取会放弃未保存修改，继续吗？")) return;
    const version = ++generation.current;
    setLoading(true); setError("");
    try {
      const client = createClient();
      const params = new URLSearchParams(window.location.search);
      const copying = !current.current && params.get("duplicate");
      const id = current.current?.row.revision ? current.current.row.id : params.get("quote") || copying;
      const [company, saved, defaults] = await Promise.all([readBrand(client, context.companyId), readQuotation(client, context, id), readQuotationDefaults(client, context.companyId)]);
      if (version !== generation.current) return;
      liveBrand.current = company; liveDefaults.current = defaults; setBrand(company);
      replace(copying && saved ? duplicateDraft(saved, company, defaults) : saved || newDraft(company, defaults));
      if (copying) setMessage("已复制为新报价草稿，请确认历史价格和条款。保存时分配新编号，不覆盖原报价。");
      // Selection is a one-time handoff. Re-entering/reloading starts a new quote.
      const url = new URL(window.location.href); url.searchParams.delete("quote"); url.searchParams.delete("new"); url.searchParams.delete("duplicate");
      window.history.replaceState(null, "", url.pathname + url.search);
    } catch (err) { if (version === generation.current) { setError(`云端报价／公司资料读取失败：${err.message}。请确认已执行最新报价 SQL。当前草稿未清空。`); } }
    finally { if (version === generation.current) setLoading(false); }
  }

  useEffect(() => {
    void reload();
    const leave = event => { if (current.current?.dirty || working.current) { event.preventDefault(); event.returnValue = ""; } };
    const link = event => {
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank" || (!current.current?.dirty && !working.current)) return;
      if (working.current || !window.confirm("还有未保存的报价修改。离开会放弃这些修改，继续吗？")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", leave); document.addEventListener("click", link, true);
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
    return () => { ++generation.current; ++renewId; clearInterval(timer); window.removeEventListener("focus", renew); window.removeEventListener("beforeunload", leave); document.removeEventListener("click", link, true); };
  }, []);

  function edit(task) {
    if (!current.current || working.current) return;
    replace({ ...task(current.current), dirty: true }); setMessage("");
  }

  async function save(value = current.current) {
    if (!value || working.current) throw new Error("报价资料尚未就绪或正在保存。");
    working.current = true; setBusy(true); setError(""); setMessage("正在保存到公司云端…");
    const version = generation.current;
    try {
      const result = await saveQuotation(createClient(), context, value);
      if (version !== generation.current) throw new Error("账号或公司已改变，请在原公司核对保存结果。");
      replace(result); setMessage("已保存到公司云端，可在其他设备重新打开。");
      return result;
    } catch (err) {
      if (version === generation.current) { replace({ ...value, dirty: true }); setError(`保存失败：${err.message}`); setMessage("保存未确认，修改仅暂存在当前页面内存。请勿离开，并核对后重试。"); }
      throw err;
    } finally { working.current = false; setBusy(false); }
  }

  function add(product) {
    const value = current.current;
    if (!value || working.current) return;
    const existing = value.items.find(line => line.product.id === product.id);
    if ((existing && (quantityToMillis(existing.quantity) === null || quantityToMillis(existing.quantity) + 1000 > MAX_QUANTITY * 1000)) || (!existing && value.items.length >= 200)) { setError("报价数量或产品行数已达到上限。"); return; }
    const items = existing ? value.items.map(line => {
      if (line.product.id !== product.id) return line;
      const next = { ...line, quantity: (quantityToMillis(line.quantity) + 1000) / 1000 };
      return { ...next, lineTotal: lineCents(next) / 100 };
    }) : [...value.items, { product: { id: product.id, serial: product.serial, name: product.name, unit: product.unit || "件", description: product.description || "", is_service: product.is_service === true }, quantity: 1, unitPrice: Number(product.price), lineTotal: Number(product.price) }];
    edit(prev => ({ ...prev, items })); return true;
  }

  function startNew() {
    if (!current.current || working.current) return false;
    if (current.current.dirty && !window.confirm("未保存修改将被放弃，已保存报价会保留。开始新报价吗？")) return false;
    reset(); return true;
  }
  function addTemporary(fields) {
    const price = moneyToCents(fields.price), quantity = quantityToMillis(fields.quantity), name = fields.name.trim(), unit = fields.unit.trim();
    if (!name || name.length > 240 || !unit || unit.length > 30 || price === null || price / 100 > MAX_UNIT_PRICE || quantity === null || (fields.description || "").length > 2000) throw new Error("请填写有效的临时项目名称、单位、数量和单价。");
    if (!current.current || working.current || current.current.items.length >= 200) throw new Error("报价未就绪或已达到 200 项上限。");
    const line = { product: { id: `temp-${crypto.randomUUID()}`, serial: "临时项目", name, unit, description: fields.description || "", is_service: fields.service === true, temporary: true }, quantity: quantity / 1000, unitPrice: price / 100 };
    edit(prev => ({ ...prev, items: [...prev.items, { ...line, lineTotal: lineCents(line) / 100 }], temporaryDraft: null }));
  }
  function reset() {
    replace(newDraft(liveBrand.current, liveDefaults.current)); setError(""); setMessage("新报价：生成／分享时自动保存到公司云端。");
    const url = new URL(window.location.href); url.searchParams.delete("quote"); url.searchParams.delete("new"); url.searchParams.delete("duplicate");
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  function complete(id) {
    if (working.current || current.current?.dirty || current.current?.row.id !== id) return false;
    reset(); return true;
  }
  return { ...draft, brand, loading, busy, error, message,
    ready: !loading && !!draft, save, add, addTemporary, startNew, reload, complete,
    markDirty: () => edit(prev => prev),
    setTemporaryDraft: value => edit(prev => ({ ...prev, temporaryDraft: value })),
    setItems: value => edit(prev => ({ ...prev, items: typeof value === "function" ? value(prev.items) : value })),
    setDetails: value => edit(prev => ({ ...prev, details: typeof value === "function" ? value(prev.details) : value })) };
}
