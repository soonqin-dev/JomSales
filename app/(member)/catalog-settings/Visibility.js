"use client";
// VIS｜产品公开设置 — which products may appear in customer catalog links. Admin only.
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { catalogLinkError } from "../../../lib/supabase/catalog-links";
import { useMember } from "../../member-context";
import { InlineError, Pager, SearchBox, SkeletonList, useConfirm, useToast } from "../../ui";

export default function Visibility({ blocked = false, onBusyChange }) {
  const member = useMember(), confirm = useConfirm(), toast = useToast();
  const [query, setQuery] = useState(""), [products, setProducts] = useState({ items: [], has_more: false }), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const sequence = useRef(0), cursors = useRef([null]), working = useRef(false);

  useEffect(() => {
    const version = ++sequence.current;
    setLoading(true); setError("");
    const cursor = cursors.current[page];
    const timer = setTimeout(async () => {
      try {
        const result = await createClient().rpc("search_catalog_share_products", { target_company: member.companyId, search_text: query, after_created: cursor?.created_at || null, after_id: cursor?.id || null });
        if (result.error) throw result.error;
        if (version === sequence.current) setProducts(result.data);
      } catch (err) { if (version === sequence.current) { setProducts({ items: [], has_more: false }); setError(catalogLinkError(err.message)); } }
      finally { if (version === sequence.current) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); ++sequence.current; };
  }, [query, page, attempt]);

  async function run(task) {
    if (working.current || blocked) return;
    working.current = true; setBusy(true); onBusyChange?.(true); setError("");
    try { await task(); } catch (err) { setError(catalogLinkError(err.message)); }
    finally { working.current = false; setBusy(false); onBusyChange?.(false); }
  }

  async function toggle(product) {
    await run(async () => {
      const result = await createClient().rpc("set_product_catalog_visibility", { target_company: member.companyId, target_product: product.id, expected_revision: product.revision, visible: !product.catalog_public });
      if (result.error) throw result.error;
      setProducts(prev => ({ ...prev, public_total: (prev.public_total || 0) + (product.catalog_public ? -1 : 1), items: prev.items.map(item => item.id === product.id ? { ...item, ...result.data } : item) }));
      if (!product.catalog_public) toast("已允许公开，请确认照片和说明里没有价格或内部资料", { duration: 3500 });
    });
  }

  async function bulk(visible) {
    const total = products.total || 0;
    if (!(await confirm({ title: `${visible ? "允许公开" : "停止公开"} ${total} 项产品？`, danger: !visible, confirmLabel: visible ? "全部允许公开" : "全部停止公开",
      message: `会作用于当前搜索的全部 ${total} 项结果（不只是这一页）。${visible ? "请先确认照片、名称、标签和说明里没有价格或内部资料。" : "停止公开不是删除；现有链接里将看不到这些产品。"}` }))) return;
    await run(async () => {
      const result = await createClient().rpc("set_catalog_visibility_batch", { target_company: member.companyId, search_text: query, expected_count: total, visible });
      if (result.error) throw result.error;
      toast(`已修改 ${result.data} 项产品`);
      setAttempt(n => n + 1);
    });
  }

  function go(next) {
    if (loading || next < 0) return;
    if (next > page) cursors.current[next] = products.cursor;
    setPage(next);
  }

  const total = products.total || 0, tooMany = total > 10000;
  return (
    <div className="stack">
      <div className="notice-box">只有「允许公开」的产品会出现在顾客目录链接里。顾客目录不显示价格。</div>
      <SearchBox value={query} onChange={value => { cursors.current = [null]; setPage(0); setQuery(value); }} placeholder="搜索编号或名称" />
      <div className="card flat row-between"><span className="small muted">已公开</span><strong className="num">{products.public_total || 0} / 匹配 {total}</strong></div>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || blocked || loading || !total || tooMany} onClick={() => void bulk(true)}>全部允许公开</button>
        <button type="button" className="btn btn-danger btn-sm" disabled={busy || blocked || loading || !total || tooMany} onClick={() => void bulk(false)}>全部停止公开</button>
      </div>
      {tooMany && <p className="field-hint">一次最多批量处理 10,000 项，请先缩小搜索范围。</p>}
      <InlineError onRetry={() => setAttempt(n => n + 1)}>{error}</InlineError>
      {loading ? <SkeletonList count={5} height={56} /> : !products.items.length ? <p className="small muted">没有符合的产品</p> : (
        <div className="list-card">{products.items.map(product => <div key={product.id} className="list-row">
          <span className="list-text"><span className="list-title" style={{ display: "block", fontSize: 14 }}>{product.name}</span><span className="list-desc">{product.serial}</span></span>
          <label className="switch"><input type="checkbox" aria-label={`允许公开 ${product.serial}`} checked={!!product.catalog_public} disabled={busy || blocked} onChange={() => void toggle(product)} /><span /></label>
        </div>)}</div>
      )}
      <Pager page={page} hasMore={products.has_more} disabled={loading || busy} onPrev={() => go(page - 1)} onNext={() => go(page + 1)} />
    </div>
  );
}
