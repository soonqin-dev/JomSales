"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Catalog from "../Catalog";
import { createClient } from "../../lib/supabase/client";
import { readProducts, signedProducts, saveProduct, deleteProduct } from "../../lib/supabase/products";
import useCloudQuotation from "../use-cloud-quotation";
import { canManageProducts } from "../../lib/supabase/permissions";
import { PageHeader, Status, Button } from "../ui";

function CompanyWorkspace({ context, cloud }) {
  const quotation = useCloudQuotation(context);
  return <Catalog cloud={{ ...cloud, context }} quotation={quotation} />;
}

export default function CloudCatalogPage() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const verification = useRef(0);
  const scope = useRef(null);
  const rows = useRef([]);
  const working = useRef(false);
  rows.current = items;

  async function load(requestedCompany = null) {
    if (working.current) return;
    const version = ++generation.current;
    setLoading(true); setError(""); setVerified(false);
    try {
      const client = createClient();
      const auth = await client.auth.getUser();
      if (auth.error && auth.error.name !== "AuthSessionMissingError") throw auth.error;
      if (version !== generation.current) return;
      if (!auth.data.user) {
        scope.current = null; setContext(null); setItems([]); window.location.replace("/account"); return;
      }
      const result = await client.from("company_members").select("company_id,role,can_manage_products,companies(id,name)")
        .eq("user_id", auth.data.user.id).eq("active", true);
      if (result.error) throw result.error;
      const companyId = requestedCompany || scope.current?.companyId || new URLSearchParams(window.location.search).get("company") || result.data?.[0]?.company_id;
      const member = result.data?.find(m => m.company_id === companyId);
      if (!result.data?.length) { window.location.replace("/account"); return; }
      if (!member?.companies) {
        scope.current = null; setContext(null); setItems([]);
        throw new Error("你尚未加入公司，或公司权限已被停用。请到公司账号页确认。");
      }
      const products = await readProducts(client, companyId);
      if (version !== generation.current) return;
      const next = { userId: auth.data.user.id, email: auth.data.user.email, companyId, role: member.role, can_manage_products: member.can_manage_products === true, name: member.companies.name, memberships: result.data };
      scope.current = next; setContext(next); setItems(products); setVerified(true);
    } catch (err) {
      if (version === generation.current) {
        // Preserve in-memory unsaved quotations on transient network errors.
        // Confirmed sign-out or membership denial clears the workspace above.
        setError(`云端读取失败：${err.message}。请检查网络，以及是否已执行云端产品和最新产品权限 SQL。不会改用本地资料。`);
      }
    } finally { if (version === generation.current) setLoading(false); }
  }

  useEffect(() => {
    let subscription, timer;
    try {
      subscription = createClient().auth.onAuthStateChange((event, session) => {
        const changedUser = !scope.current || session?.user.id !== scope.current.userId;
        if (!session || (scope.current && session.user.id !== scope.current.userId)) {
          ++generation.current; scope.current = null; setContext(null); setItems([]); setVerified(false);
          if (event === "SIGNED_OUT") window.location.replace("/account");
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
      const attempt = ++verification.current;
      try {
        const client = createClient();
        const auth = await client.auth.getUser();
        if (auth.error && auth.error.name !== "AuthSessionMissingError") throw auth.error;
        if (version !== generation.current || attempt !== verification.current || working.current) return;
        if (auth.data.user?.id !== current.userId) {
          if (version === generation.current) {
            ++generation.current; scope.current = null; setContext(null); setItems([]);
            window.location.replace("/account");
          }
          throw new Error("登录状态已改变，请重新登录。");
        }
        const member = await client.from("company_members").select("role,can_manage_products")
          .eq("user_id", current.userId).eq("company_id", current.companyId).eq("active", true).maybeSingle();
        if (member.error) throw member.error;
        if (version !== generation.current || attempt !== verification.current || working.current) return;
        if (!member.data) {
          if (version === generation.current) {
            ++generation.current; scope.current = null; setContext(null); setItems([]);
          }
          throw new Error("公司权限已被停用。");
        }
        const next = { ...current, role: member.data.role, can_manage_products: member.data.can_manage_products === true };
        if (version !== generation.current || attempt !== verification.current || working.current) return;
        // Close only the product editor on capability loss; preserve quotation edits.
        scope.current = next; setContext(next);
        const renewed = await signedProducts(client, rows.current);
        if (version !== generation.current || attempt !== verification.current || working.current) return;
        scope.current = next; setContext(next); setItems(renewed); setVerified(true);
      } catch (err) {
        if (attempt === verification.current && !working.current && (version === generation.current || !scope.current)) {
          setVerified(false); setError(`无法确认公司权限或更新图片：${err.message}。请刷新重试。`);
        }
      }
    }
    const interval = setInterval(() => void verify(), 120000);
    window.addEventListener("focus", verify);
    return () => { ++generation.current; clearTimeout(timer); clearInterval(interval); subscription?.unsubscribe(); window.removeEventListener("focus", verify); };
  }, []);

  async function operation(task) {
    if (working.current || !verified || !context || !canManageProducts(context)) throw new Error("当前没有可用的产品管理权限，请刷新确认。");
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

  return <>
    {!context && <main className="page accountPage">
      <PageHeader title="公司云端产品" subtitle="正在连接你的公司工作区" />
      {loading && <Status>正在读取云端产品…</Status>}
      {error && <><Status error>{error}</Status><Button disabled={loading} onClick={() => void load()}>刷新云端产品</Button></>}
      <p><Link href="/account">公司账号</Link></p>
    </main>}
    {context && <CompanyWorkspace key={`${context.userId}:${context.companyId}`} context={context} cloud={{
      items, name: context.name, canManage: verified && canManageProducts(context), canWrite: verified && !loading && canManageProducts(context) && !busy, save, remove,
      loading, busy, error, message, refresh: () => void load()
    }} />}
  </>;
}
