"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Catalog from "../Catalog";
import { createClient } from "../../lib/supabase/client";
import { readProducts, signedProducts, saveProduct, deleteProduct, importProduct } from "../../lib/supabase/products";
import { CATALOG_KEY, validCatalog, readStoredJson } from "../storage";
import { downloadFile } from "../share";

export default function CloudCatalogPage() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const generation = useRef(0);
  const scope = useRef(null);
  const rows = useRef([]);
  const working = useRef(false);
  rows.current = items;

  async function load(requestedCompany = null) {
    if (working.current) return;
    const version = ++generation.current;
    setLoading(true); setError(""); setPreview(null); setVerified(false);
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (auth.error && auth.error.name !== "AuthSessionMissingError") throw auth.error;
      if (version !== generation.current) return;
      if (!auth.data.user) {
        scope.current = null; setContext(null); setItems([]); return;
      }
      const result = await client.from("company_members").select("company_id,role,companies(id,name)")
        .eq("user_id", auth.data.user.id).eq("active", true);
      if (result.error) throw result.error;
      const companyId = requestedCompany || scope.current?.companyId || new URLSearchParams(window.location.search).get("company") || result.data?.[0]?.company_id;
      const member = result.data?.find(m => m.company_id === companyId);
      if (!member?.companies) throw new Error("你尚未加入公司，或公司权限已被停用。请到公司账号页确认。");
      const products = await readProducts(client, companyId);
      if (version !== generation.current) return;
      const next = { userId: auth.data.user.id, companyId, role: member.role, name: member.companies.name, memberships: result.data };
      scope.current = next; setContext(next); setItems(products); setVerified(true);
    } catch (err) {
      if (version === generation.current) {
        scope.current = null; setContext(null); setItems([]);
        setError(`云端读取失败：${err.message}。请检查网络，以及是否已执行云端产品 SQL。不会改用本地资料。`);
      }
    } finally { if (version === generation.current) setLoading(false); }
  }

  useEffect(() => {
    let subscription, timer;
    try {
      subscription = createClient().auth.onAuthStateChange((event, session) => {
        const changedUser = !scope.current || session?.user.id !== scope.current.userId;
        if (!session || (scope.current && session.user.id !== scope.current.userId)) {
          ++generation.current; scope.current = null; setContext(null); setItems([]); setPreview(null); setVerified(false);
        }
        if (event === "INITIAL_SESSION" || (event === "SIGNED_IN" && changedUser) || event === "SIGNED_OUT") {
          clearTimeout(timer); timer = setTimeout(() => void load(), 0);
        }
      }).data.subscription;
      void load();
    } catch (err) { setError(err.message); setLoading(false); }

    // Recheck membership and renew short-lived image links, not realtime product sync.
    async function verify() {
      const current = scope.current;
      if (!current || working.current) return;
      const version = generation.current;
      try {
        const client = createClient();
        const auth = await client.auth.getUser();
        if (auth.error && auth.error.name !== "AuthSessionMissingError") throw auth.error;
        if (auth.data.user?.id !== current.userId) {
          if (version === generation.current) {
            ++generation.current; scope.current = null; setContext(null); setItems([]); setPreview(null);
          }
          throw new Error("登录状态已改变，请重新登录。");
        }
        const member = await client.from("company_members").select("role")
          .eq("user_id", current.userId).eq("company_id", current.companyId).eq("active", true).maybeSingle();
        if (member.error) throw member.error;
        if (!member.data) {
          if (version === generation.current) {
            ++generation.current; scope.current = null; setContext(null); setItems([]); setPreview(null);
          }
          throw new Error("公司权限已被停用。");
        }
        const renewed = await signedProducts(client, rows.current);
        if (version !== generation.current || working.current) return;
        const next = { ...current, role: member.data.role };
        scope.current = next; setContext(next); setItems(renewed); setVerified(true);
      } catch (err) {
        if (version === generation.current || !scope.current) {
          setVerified(false); setError(`无法确认公司权限或更新图片：${err.message}。请刷新重试。`);
        }
      }
    }
    const interval = setInterval(() => void verify(), 120000);
    window.addEventListener("focus", verify);
    return () => { ++generation.current; clearTimeout(timer); clearInterval(interval); subscription?.unsubscribe(); window.removeEventListener("focus", verify); };
  }, []);

  async function operation(task) {
    if (working.current || !verified || !context || context.role !== "admin") throw new Error("当前没有可用的管理员权限。");
    working.current = true; setBusy(true); setError(""); setMessage("正在保存到云端…");
    const version = generation.current;
    try { return await task(createClient(), context, version); }
    catch (err) {
      if (version === generation.current) setMessage("云端保存未确认。请核对错误提示；网络中断时先刷新检查结果，再重试。");
      throw err;
    }
    finally { working.current = false; setBusy(false); }
  }

  async function save(item, previous) {
    return operation(async (client, current, version) => {
      const result = await saveProduct(client, current.companyId, item, previous);
      if (version !== generation.current) throw new Error("账号已改变，操作结果请在原公司核对。");
      let signed, imageWarning = "";
      try { [signed] = await signedProducts(client, [result.row]); }
      catch {
        signed = { ...result.row, price: Number(result.row.price).toFixed(2), image: item.image };
        imageWarning = "图片链接刷新失败，请稍后刷新云端产品。";
      }
      if (version !== generation.current) return;
      setItems(prev => previous ? prev.map(p => p.id === signed.id ? signed : p) : [signed, ...prev]);
      setMessage(`已保存到云端。${result.warning}${imageWarning}`);
    });
  }

  async function remove(item) {
    return operation(async (client, current, version) => {
      const warning = await deleteProduct(client, current.companyId, item);
      if (version !== generation.current) return;
      setItems(prev => prev.filter(p => p.id !== item.id));
      setMessage(`产品已删除，其他设备刷新后可见。${warning}`);
    });
  }

  function prepareImport() {
    try {
      const local = readStoredJson(CATALOG_KEY, validCatalog, []);
      if (!local.length) throw new Error("本机没有可导入的产品。");
      setPreview(local); setError(""); setMessage("");
    } catch (err) { setError(err.message); }
  }

  async function importLocal() {
    if (!preview || !window.confirm(`确认将这 ${preview.length} 项本地产品导入 ${context.name}？本地资料会保留，已导入项目会跳过。`)) return;
    try {
      await operation(async (client, current, version) => {
        let imported = 0, skipped = 0;
        const failed = [];
        for (const item of preview) {
          if (version !== generation.current) break;
          try {
            const result = await importProduct(client, current.companyId, item);
            result === "imported" ? imported++ : skipped++;
          } catch (err) { failed.push(`${item.serial || item.name}：${err.message}`); }
          if (version === generation.current) setMessage(`正在导入：新增 ${imported}，跳过 ${skipped}，失败 ${failed.length}。`);
        }
        if (version !== generation.current) return;
        setMessage(`导入完成：新增 ${imported}，跳过 ${skipped}，失败 ${failed.length}。本地原件保留，可重试失败项目。`);
        if (failed.length) setError(failed.join("；"));
        try {
          const importedRows = await readProducts(client, current.companyId);
          if (version === generation.current) setItems(importedRows);
        }
        catch (err) { setError(`导入结果已记录，但刷新失败：${err.message}。请刷新云端产品。`); }
        if (version === generation.current) setPreview(null);
      });
    } catch (err) { setError(err.message); }
  }

  return <>
    <div className="cloudControls">
      <Link href="/">← 本地产品（保留的原件）</Link>
      <h1>公司云端产品</h1>
      <p>仅管理员可维护产品；销售员可查阅。其他设备更新后，请刷新读取。图片链接五分钟有效，页面会定期续期。已下载或分享的内容无法撤回。</p>
      <div className="cloudButtons">
        <button disabled={busy || loading} onClick={() => void load()}>刷新云端产品</button>
        <Link href="/account">公司账号</Link>
        {context?.role === "admin" && <Link href={`/team?company=${context.companyId}`}>员工与邀请</Link>}
      </div>
      {loading && <p role="status">正在读取云端产品…</p>}
      {!loading && !context && !error && <p><Link href="/account">请先登录并创建或加入公司</Link></p>}
      {context && context.memberships.length > 1 && <label>当前公司 <select value={context.companyId} disabled={busy} onChange={e => void load(e.target.value)}>
        {context.memberships.map(m => <option key={m.company_id} value={m.company_id}>{m.companies?.name}</option>)}
      </select></label>}
      {error && <p className="accountError" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {context?.role === "admin" && !loading && <div className="cloudButtons">
        <button disabled={busy || !verified} onClick={prepareImport}>预览本地产品导入</button>
      </div>}
      {preview && <section className="notice">
        <h2>导入目标：{context?.name}</h2>
        <p>共 {preview.length} 项。本地数据不会删除；已导入或已在云端删除的本地项目会跳过。相同编号但不同来源会报冲突，不会覆盖云端产品。</p>
        <ul>{preview.slice(0, 20).map(p => <li key={p.id}>{p.serial} · {p.name}</li>)}</ul>
        {preview.length > 20 && <p>这里只预览前 20 项。</p>}
        <div className="cloudButtons">
          <button disabled={busy} onClick={() => downloadFile(new File([JSON.stringify(preview, null, 2)], "SalesGo-local-products-backup.json", { type: "application/json" }))}>下载本地备份</button>
          <button disabled={busy || !verified} onClick={() => void importLocal()}>确认导入公司</button>
          <button disabled={busy} onClick={() => setPreview(null)}>取消导入</button>
        </div>
      </section>}
    </div>
    {!loading && context && <Catalog key={`${context.userId}:${context.companyId}:${context.role}`} cloud={{
      items, name: context.name, canWrite: verified && context.role === "admin" && !busy, save, remove
    }} />}
  </>;
}
