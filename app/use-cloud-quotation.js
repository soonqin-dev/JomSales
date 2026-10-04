"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { readBrand, readQuotation, newDraft, saveQuotation, signedBrand } from "../lib/supabase/workspace";
import { MAX_QUANTITY } from "./quotation-utils";

export default function useCloudQuotation(context) {
  const [draft, setDraft] = useState(null);
  const [brand, setBrand] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const current = useRef(null), liveBrand = useRef(null), generation = useRef(0), working = useRef(false);
  const requested = useRef(false);
  function replace(value) { current.current = value; setDraft(value); }

  async function reload() {
    if (working.current) return;
    if (current.current?.dirty && !window.confirm("重新读取会放弃未保存修改，继续吗？")) return;
    const version = ++generation.current;
    setLoading(true); setError("");
    try {
      const client = createClient();
      const params = new URLSearchParams(window.location.search), id = params.get("quote");
      const [company, saved] = await Promise.all([readBrand(client, context.companyId), params.has("new") ? Promise.resolve(null) : readQuotation(client, context, id)]);
      if (version !== generation.current) return;
      requested.current = !!id; liveBrand.current = company; setBrand(company); replace(saved || newDraft(company));
    } catch (err) { if (version === generation.current) { replace(null); setError(`云端报价／公司资料读取失败：${err.message}。请确认已执行全云端 SQL。`); } }
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
        const company = await readBrand(createClient(), context.companyId);
        const value = current.current;
        const snapshot = value.row.revision ? await signedBrand(createClient(), value.company) : company;
        if (id !== renewId || version !== generation.current || working.current || value !== current.current) return;
        liveBrand.current = company; setBrand(company); replace({ ...value, company: snapshot });
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
      replace(result); setMessage("已保存到公司云端，可在其他设备重新打开。"); return result;
    } catch (err) {
      if (version === generation.current) { replace({ ...value, dirty: true }); setError(`保存失败：${err.message}`); setMessage("保存未确认，修改仅暂存在当前页面内存。请勿离开，并核对后重试。"); }
      throw err;
    } finally { working.current = false; setBusy(false); }
  }

  async function add(product) {
    const value = current.current;
    if (!value || working.current) return;
    const existing = value.items.find(line => line.product.id === product.id);
    if (existing?.quantity >= MAX_QUANTITY || (!existing && value.items.length >= 200)) { setError("报价数量或产品行数已达到上限。"); return; }
    const items = existing ? value.items.map(line => line.product.id === product.id ? { ...line, quantity: line.quantity + 1, lineTotal: (line.quantity + 1) * line.unitPrice } : line)
      : [...value.items, { product: { id: product.id, serial: product.serial, name: product.name }, quantity: 1, unitPrice: Number(product.price), lineTotal: Number(product.price) }];
    try { return await save({ ...value, items, dirty: true }); } catch { /* Visible controller error; never a localStorage fallback. */ }
  }

  function startNew() {
    if (!current.current || working.current) return false;
    if (!window.confirm("新建报价会清空当前页面的产品和客户资料；已保存的报价会保留在云端。未保存修改将被放弃，继续吗？")) return false;
    replace(newDraft(liveBrand.current)); setError(""); setMessage("已开始新报价，加入产品或点击保存后写入云端。");
    const url = new URL(window.location.href); url.searchParams.delete("quote"); window.history.replaceState(null, "", url.pathname + url.search);
    requested.current = false;
    return true;
  }
  return { ...draft, brand, loading, busy, error, message, requested: requested.current,
    ready: !loading && !!draft, save, add, startNew, reload,
    setItems: value => edit(prev => ({ ...prev, items: typeof value === "function" ? value(prev.items) : value })),
    setDetails: value => edit(prev => ({ ...prev, details: typeof value === "function" ? value(prev.details) : value })) };
}
