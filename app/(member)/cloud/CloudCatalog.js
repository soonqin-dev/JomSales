"use client";
// CAT｜产品目录 — docs/daily-flow-spec.md §2, Figma docs/figma/CAT.png.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { readProducts, readProductDetail, signedProducts, saveProduct, deleteProduct } from "../../../lib/supabase/products";
import { readCategories } from "../../../lib/supabase/categories";
import { canManageProducts } from "../../../lib/supabase/permissions";
import { useCurrentQuote, useMember } from "../../member-context";
import { EmptyState, FilterMenu, InlineError, MoreMenu, Pager, SearchBox, Sheet, SkeletonGrid, initials, useConfirm, useToast } from "../../ui";
import { canShareFile, downloadFile } from "../../share";
import Icon from "../../icons";
import ProductDetail from "./ProductDetail";
import ProductForm from "./ProductForm";

export default function CloudCatalog() {
  const member = useMember(), quote = useCurrentQuote();
  const router = useRouter(), toast = useToast(), confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(""), [category, setCategory] = useState(null), [categories, setCategories] = useState([]);
  const [page, setPage] = useState(0), [pageInfo, setPageInfo] = useState({ total: 0, has_more: false, cursor: null });
  const [detail, setDetail] = useState(null), [form, setForm] = useState(null), [picker, setPicker] = useState(false);
  const [added, setAdded] = useState(null);
  const generation = useRef(0), cursors = useRef([null]), rows = useRef([]), filters = useRef({ query: "", category: null });
  const working = useRef(false);
  rows.current = items;
  const canManage = canManageProducts(member);
  const roleName = member.role === "admin" ? "管理员" : "销售员";

  async function load({ cursor = cursors.current[page] || null, quiet = false } = {}) {
    const version = ++generation.current;
    if (quiet) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const client = createClient();
      const [products, categoryRows] = await Promise.all([
        readProducts(client, member.companyId, { query: filters.current.query, cursor, category: filters.current.category }),
        readCategories(client, member.companyId)
      ]);
      if (version !== generation.current) return;
      setItems(products.items); setPageInfo(products); setCategories(categoryRows);
    } catch (err) {
      if (version === generation.current) setError(`产品读取失败：${err.message}`);
    } finally {
      if (version === generation.current) { setLoading(false); setRefreshing(false); }
    }
  }

  // Search is debounced; changing search or filter returns to page 1.
  useEffect(() => {
    filters.current = { query, category };
    cursors.current = [null]; setPage(0);
    const timer = setTimeout(() => void load({ cursor: null }), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, category]);

  // Renew five-minute signed image links; not realtime product sync.
  useEffect(() => {
    async function renew() {
      if (working.current || !rows.current.length) return;
      const version = generation.current;
      try {
        const renewed = await signedProducts(createClient(), rows.current);
        if (version === generation.current && !working.current) setItems(renewed);
      } catch { /* the next refresh reports errors */ }
    }
    const timer = setInterval(renew, 120000);
    window.addEventListener("focus", renew);
    return () => { ++generation.current; clearInterval(timer); window.removeEventListener("focus", renew); };
  }, []);

  function go(next) {
    if (loading || next < 0) return;
    if (next > page) cursors.current[next] = pageInfo.cursor;
    setPage(next);
    void load({ cursor: cursors.current[next] || null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openDetail(item) {
    try { setDetail(await readProductDetail(createClient(), member.companyId, item.id)); }
    catch (err) { toast(err.message); }
  }

  function addToQuote(item) {
    const result = quote.add(item);
    if (!result.ok) { toast(result.reason); return false; }
    setAdded(item.id); setTimeout(() => setAdded(value => (value === item.id ? null : value)), 600);
    return true;
  }

  async function openEditor(item) {
    if (!item) { setForm({ record: null }); return; }
    try { setForm({ record: await readProductDetail(createClient(), member.companyId, item.id) }); }
    catch (err) { toast(err.message); }
  }

  async function operation(task) {
    if (working.current || !canManageProducts(member)) throw new Error("当前没有产品管理权限，请刷新确认。");
    working.current = true; setBusy(true);
    try { return await task(createClient()); } finally { working.current = false; setBusy(false); }
  }

  async function save(item, previous) {
    return operation(async client => {
      const result = await saveProduct(client, member.companyId, item, previous);
      cursors.current = [null]; setPage(0);
      await load({ cursor: null, quiet: true });
      toast(result.warning ? `已保存。${result.warning}` : "已保存");
    });
  }

  async function remove(item) {
    if (!(await confirm({ title: `删除 ${item.name}？`, message: "已有报价不受影响。删除后其他设备刷新可见。", confirmLabel: "删除产品", danger: true }))) return;
    try {
      const warning = await operation(client => deleteProduct(client, member.companyId, item));
      setDetail(null);
      await load({ quiet: true });
      toast(warning ? `产品已删除。${warning}` : "产品已删除");
    } catch (err) { toast(`删除失败：${err.message}`); }
  }

  const filterOptions = [{ value: null, label: "全部" },
    ...categories.filter(c => c.name && (c.active || Number(c.product_count) > 0)).map(c => ({ value: c.name, label: c.active ? c.name : `${c.name}（已停用）` })),
    { value: "", key: "__none", label: "未分类" }];
  const editing = !!quote.row?.revision;
  const hasQuote = editing || quote.items?.length > 0 || !!quote.copiedFrom;

  return (
    <main className="app-main">
      <header className="cat-head">
        <div className="cat-identity">
          <span className="avatar" aria-hidden="true">{initials(member.displayName, member.email)}</span>
          <div className="grow">
            <p className="who ellipsis">{roleName} - {member.displayName}</p>
            <p className="mail ellipsis">{member.email}</p>
          </div>
        </div>
        <div className="row">
          <button type="button" className="company-pill ellipsis" disabled={member.memberships.length < 2}
            aria-label={member.memberships.length > 1 ? `当前公司 ${member.name}，点此切换` : `当前公司 ${member.name}`} onClick={() => setPicker(true)}>{member.name}</button>
          <span className="pill pill-navy num">{pageInfo.total || 0} 项产品</span>
          <button type="button" className={`icon-btn${refreshing ? " spin" : ""}`} aria-label="刷新产品" disabled={refreshing || loading}
            onClick={() => void load({ quiet: true })}><Icon name="refresh" size={20} /></button>
        </div>
      </header>

      <div className="stack">
        <div className="search-row" style={{ position: "relative" }}>
          <SearchBox value={query} onChange={setQuery} placeholder="搜索产品编号、名称、标签..." label="搜索产品" />
          <FilterMenu options={filterOptions} value={category} onChange={setCategory} active={category !== null} />
        </div>

        {canManage && <button type="button" className="btn btn-primary btn-block" style={{ minHeight: 52, fontSize: 16 }} disabled={busy} onClick={() => void openEditor(null)}>
          <Icon name="plus" size={20} strokeWidth={2.25} />新增产品</button>}

        <div className="quote-bar">
          <button type="button" className="quote-bar-main" onClick={() => router.push("/cloud/quote")} aria-label="打开当前报价">
            <span className="ident">{hasQuote ? `正在编辑：${editing ? quote.details.number : "新报价"}` : "新报价"}</span>
            {hasQuote && <span className={`state${quote.dirty ? "" : " saved"}`}>{quote.dirty ? "未保存" : "已保存"}</span>}
          </button>
          {quote.copiedFrom && <span className="small muted ellipsis">复制自 {quote.copiedFrom}</span>}
          <Link href="/quotations" className="btn btn-secondary btn-xs">报价记录</Link>
        </div>

        {quote.lastPdf && <LastPdf value={quote.lastPdf} onClose={() => quote.setLastPdf(null)} />}
        {quote.error && <InlineError>{quote.error}</InlineError>}
        {error && <InlineError onRetry={() => void load()}>{error}</InlineError>}

        {loading ? <SkeletonGrid /> : !items.length ? (
          query || category !== null
            ? <EmptyState title="没有符合的产品" action={<button type="button" className="btn btn-secondary btn-sm" onClick={() => { setQuery(""); setCategory(null); }}>清除搜索</button>} />
            : <EmptyState icon="bag" title="还没有产品" action={canManage && <button type="button" className="btn btn-primary btn-sm" onClick={() => void openEditor(null)}>新增产品</button>} />
        ) : (
          <section className="product-grid" aria-label="产品列表">
            {items.map(item => (
              <article key={item.id} className="product-card" onClick={() => void openDetail(item)}>
                <div className="thumb">
                  {item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" /> : <div className="img-ph">{item.imageError ? "照片暂时无法读取" : ""}</div>}
                  <button type="button" className={`add-quote${added === item.id ? " done" : ""}`} aria-label={`把 ${item.name} 加入报价`}
                    onClick={event => { event.stopPropagation(); addToQuote(item); }}>
                    <span><Icon name={added === item.id ? "check" : "plus"} size={16} strokeWidth={2.5} /></span>
                  </button>
                </div>
                <div className="body">
                  <button type="button" className="pname pname-btn" aria-haspopup="dialog"
                    onClick={event => { event.stopPropagation(); void openDetail(item); }}>{item.name}</button>
                  <span className="sku">{item.serial}</span>
                </div>
                <div className="foot">
                  <span className="price">RM{item.price} <small>/ {item.unit || "件"}</small></span>
                  {canManage && <MoreMenu label={`${item.name} 的更多操作`} up disabled={busy} items={[
                    { label: "编辑产品", icon: "sliders", onSelect: () => void openEditor(item) },
                    { label: "删除产品", icon: "trash", danger: true, onSelect: () => void remove(item) }
                  ]} />}
                </div>
              </article>
            ))}
          </section>
        )}
        <Pager page={page} hasMore={pageInfo.has_more} disabled={loading} onPrev={() => go(page - 1)} onNext={() => go(page + 1)} />
      </div>

      {detail && <ProductDetail product={detail} onClose={() => setDetail(null)} onAdd={addToQuote}
        onRenew={async () => setDetail(await readProductDetail(createClient(), member.companyId, detail.id))} />}
      {form && <ProductForm record={form.record} categories={categories} busy={busy} onSave={save} onClose={() => setForm(null)} />}
      {picker && <Sheet title="切换公司" subtitle="切换后会重新读取该公司的产品" onClose={() => setPicker(false)}>
        <div className="list-card">
          {member.memberships.map(m => <button key={m.company_id} type="button" className="list-row" onClick={async () => { setPicker(false); await member.switchCompany(m.company_id); }}>
            <span className="list-icon"><Icon name="building" size={20} /></span>
            <span className="list-text"><span className="list-title">{m.companies?.name}</span><span className="list-desc"> {m.role === "admin" ? "管理员" : "销售员"}</span></span>
            {m.company_id === member.companyId && <Icon name="check" />}
          </button>)}
        </div>
      </Sheet>}
    </main>
  );
}

// CAT.LAST_PDF: the file generated by the last completed quote.
function LastPdf({ value, onClose }) {
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  async function share() {
    if (!canShareFile(value.file)) { downloadFile(value.file); toast("已为你下载，可在文件中发送"); return; }
    setSharing(true);
    try { await navigator.share({ files: [value.file], title: `Quotation ${value.number}` }); }
    catch (err) { if (err.name !== "AbortError") toast("分享未完成，请下载后发送。"); }
    finally { setSharing(false); }
  }
  return (
    <div className="card flat stack-sm">
      <div className="row-between">
        <div className="row"><Icon name="check" size={20} /><strong>报价 {value.number} 已保存</strong></div>
        <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadFile(value.file)}><Icon name="download" size={18} />下载</button>
        <button type="button" className="btn btn-share btn-sm" disabled={sharing} onClick={share}><Icon name="send" size={18} />分享</button>
      </div>
    </div>
  );
}
