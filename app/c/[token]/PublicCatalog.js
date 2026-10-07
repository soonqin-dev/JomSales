"use client";
// PUB｜顾客产品目录 — docs/pages-spec.md §7. No login, no navigation, never any price.
import { useEffect, useRef, useState } from "react";
import { EmptyState, FilterMenu, Pager, SearchBox, Sheet, SkeletonGrid } from "../../ui";
import Icon from "../../icons";

export function InvalidCatalog({ onRetry }) {
  return (
    <main className="app-main no-nav" style={{ display: "grid", placeItems: "center" }}>
      <div className="empty-state" style={{ maxWidth: 360 }}>
        <Icon name="link" size={48} />
        <h1 className="section-title" style={{ color: "var(--text)", fontSize: 20 }}>这个链接已失效</h1>
        <p>可能已过期或被撤销，请向分享给你的人索取新链接。</p>
        {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>重新检查</button>}
      </div>
    </main>
  );
}

export default function PublicCatalog({ token }) {
  const [data, setData] = useState(null), [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [invalid, setInvalid] = useState(false), [selected, setSelected] = useState(null);
  const [imageErrors, setImageErrors] = useState({}), [category, setCategory] = useState(null);
  const categoryRef = useRef(null), sequence = useRef(0), abort = useRef(null), cursors = useRef([null]), current = useRef({ query: "", page: 0 }), loadRef = useRef(null);
  const api = `/api/catalog/${token}`;

  async function load() {
    const version = ++sequence.current; abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError("");
    const state = current.current, params = new URLSearchParams({ q: state.query }), cursor = cursors.current[state.page];
    if (categoryRef.current !== null) params.set("category", categoryRef.current);
    if (cursor) { params.set("after_created", cursor.created_at); params.set("after_id", cursor.id); }
    try {
      const response = await fetch(`${api}?${params}`, { cache: "no-store", signal: controller.signal }), result = await response.json();
      if (version !== sequence.current) return;
      // PUB.INVALID never shows the company, the contact or any product.
      if (response.status === 404 || (response.ok && Date.parse(result.expires_at) <= Date.now())) { setInvalid(true); setData(null); return; }
      if (!response.ok) throw new Error(result.error || "目录读取失败，请重试。");
      setInvalid(false); setData(result);
    } catch (err) { if (version === sequence.current && err.name !== "AbortError") setError(err.message || "网络暂时不可用，请重试。"); }
    finally { if (version === sequence.current) setBusy(false); }
  }
  loadRef.current = load;
  useEffect(() => { const timer = setTimeout(() => void loadRef.current(), 200); return () => { clearTimeout(timer); ++sequence.current; abort.current?.abort(); }; }, [query, page, category]);
  useEffect(() => {
    const refresh = () => void loadRef.current(), timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => {
    if (!data) return;
    const delay = Math.max(0, Math.min(2147483647, Date.parse(data.expires_at) - Date.now()));
    const timer = setTimeout(() => { ++sequence.current; abort.current?.abort(); setData(null); setSelected(null); setInvalid(true); }, delay);
    return () => clearTimeout(timer);
  }, [data]);

  function search(value) { current.current = { query: value, page: 0 }; cursors.current = [null]; setSelected(null); setQuery(value); setPage(0); }
  function navigate(next) {
    if (busy || !data || next < 0) return;
    if (next > page) cursors.current[next] = data.cursor;
    current.current = { query, page: next }; setSelected(null); setPage(next); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function filterCategory(value) { categoryRef.current = value; setCategory(value); search(query); }
  const imageFailed = id => setImageErrors(prev => ({ ...prev, [id]: true }));

  if (invalid) return <InvalidCatalog onRetry={() => { setInvalid(false); void load(); }} />;

  const categories = (data?.categories || []).map(c => typeof c === "string" ? c : c.name).filter(Boolean);
  return (
    <main className="app-main no-nav">
      <header className="cat-head" style={{ gap: 10 }}>
        <div className="row-between" style={{ alignItems: "flex-start" }}>
          <h1 className="topbar-title" style={{ fontSize: 24 }}>{data?.company_name || "产品目录"}</h1>
          <button type="button" className={`icon-btn${busy ? " spin" : ""}`} aria-label="刷新目录" disabled={busy} onClick={() => void load()}><Icon name="refresh" size={20} /></button>
        </div>
        {data && <div className="card flat row-between" style={{ padding: 12 }}>
          <div className="grow"><p className="small muted">联系人</p><p className="card-title">{data.seller_name}</p></div>
          {data.whatsapp && <a className="btn btn-share btn-sm" href={`https://wa.me/${String(data.whatsapp).replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"><Icon name="whatsapp" size={18} />WhatsApp 联系</a>}
        </div>}
        {data && <p className="small muted">有效至 {new Date(data.expires_at).toLocaleDateString("sv-SE")}</p>}
      </header>
      <div className="stack">
        <div className="search-row" style={{ position: "relative" }}>
          <SearchBox value={query} onChange={search} placeholder="搜索产品编号、名称、标签" label="搜索产品" />
          {categories.length > 0 && <FilterMenu value={category} onChange={filterCategory} active={category !== null}
            options={[{ value: null, label: "全部" }, ...categories.map(name => ({ value: name, label: name }))]} />}
        </div>
        {data && <p className="small muted">共 {data.total} 件</p>}
        {error && <div className="inline-error" role="alert"><span className="grow">{error}</span><button type="button" className="text-btn" onClick={() => void load()}>重试</button></div>}
        {busy && !data ? <SkeletonGrid /> : data && !data.items.length ? <EmptyState title="没有符合的产品" /> : data && (
          <section className="product-grid" aria-label="产品列表">
            {data.items.map(p => (
              <button key={p.id} type="button" className="product-card" onClick={() => setSelected(p)}>
                <div className="thumb">
                  {p.has_image && !imageErrors[p.id] ? <img src={`${api}/image/${p.id}`} alt="" loading="lazy" decoding="async" onError={() => imageFailed(p.id)} />
                    : <div className="img-ph">{p.has_image ? "图片暂时无法显示" : ""}</div>}
                </div>
                <div className="body" style={{ paddingBottom: 10 }}>
                  <span className="pname">{p.name}</span>
                  <span className="sku">{p.serial} · {p.unit || "件"}</span>
                </div>
              </button>
            ))}
          </section>
        )}
        {data && <Pager page={page} hasMore={data.has_more} disabled={busy} onPrev={() => navigate(page - 1)} onNext={() => navigate(page + 1)} />}
        <p className="small muted" style={{ textAlign: "center", padding: "16px 0" }}>Powered by JomSales</p>
      </div>

      {selected && <Sheet title={selected.name} subtitle={`${selected.serial} · ${selected.unit || "件"}`} onClose={() => setSelected(null)} footer={
        <a className="btn btn-share btn-block" href={`${api}/inquire/${selected.id}`} target="_blank" rel="noopener noreferrer"><Icon name="whatsapp" size={20} />WhatsApp 询价</a>}>
        <div className="prd-image">
          {selected.has_image && !imageErrors[selected.id] ? <img src={`${api}/image/${selected.id}?full=1`} alt={selected.name} onError={() => imageFailed(selected.id)} />
            : <div className="img-ph">{selected.has_image ? "图片暂时无法显示" : "暂无照片"}</div>}
        </div>
        {!!selected.tags?.length && <div className="chips">{selected.tags.map((tag, i) => <span className="chip" key={`${tag}-${i}`}>{tag}</span>)}</div>}
        {selected.category && <p className="small">分类：{selected.category}</p>}
        {selected.description && <p className="muted preserveLines">{selected.description}</p>}
      </Sheet>}
    </main>
  );
}
