"use client";
// SHR｜分享中心 + SHC｜新建目录分享 — docs/pages-spec.md §2.
// Product visibility (VIS) lives in /catalog-settings?tab=public.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { newCatalogLinkRequest, createCatalogLink, listCatalogLinks, catalogLinkError } from "../../../lib/supabase/catalog-links";
import { useMember } from "../../member-context";
import { EmptyState, InlineError, MoreMenu, Pager, RefreshButton, SearchBox, SkeletonList, TopBar, useConfirm, useToast } from "../../ui";
import Icon from "../../icons";

const linkUrl = row => `${window.location.origin}/c/${row.token}`;
const isActive = row => !row.revoked_at && Date.parse(row.expires_at) > Date.now();
const day = value => new Date(value).toLocaleDateString("sv-SE");

function useLinkActions(companyName) {
  const toast = useToast();
  async function copy(row) {
    try { await navigator.clipboard.writeText(linkUrl(row)); toast("链接已复制，可贴到 WhatsApp"); }
    catch { toast("未能自动复制，请打开链接后从地址栏复制"); }
  }
  async function share(row) {
    if (!navigator.share) { await copy(row); return; }
    try { await navigator.share({ title: `${companyName} · 产品目录`, url: linkUrl(row) }); }
    catch (err) { if (err.name !== "AbortError") toast("分享未完成，可以复制链接发送"); }
  }
  return { copy, share };
}

export default function CatalogShare() {
  const [view, setView] = useState("list");
  const [created, setCreated] = useState(null);
  if (view === "new") return <ShareCreate onDone={row => { setCreated(row); setView("list"); }} onBack={() => setView("list")} />;
  return <ShareList created={created} onCreate={() => setView("new")} />;
}

function ContactCard({ profile }) {
  return (
    <section className="card row-between">
      <div className="grow">
        <p className="small muted">我的联系资料</p>
        <p className="card-title ellipsis">{profile.displayName || "未设置姓名"} · {profile.whatsapp || "未设置 WhatsApp"}</p>
      </div>
      <Link href="/me/profile" className="btn btn-secondary btn-xs">修改</Link>
    </section>
  );
}

function ShareList({ created, onCreate }) {
  const member = useMember(), confirm = useConfirm(), toast = useToast();
  const { copy, share } = useLinkActions(member.name);
  const [links, setLinks] = useState({ items: [], hasMore: false }), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const sequence = useRef(0), cursors = useRef([null]);
  const admin = member.role === "admin";

  useEffect(() => {
    const version = ++sequence.current;
    setLoading(true); setError("");
    listCatalogLinks(createClient(), member.companyId, cursors.current[page])
      .then(result => { if (version === sequence.current) setLinks(result); })
      .catch(err => { if (version === sequence.current) setError(`链接读取失败：${err.message}`); })
      .finally(() => { if (version === sequence.current) setLoading(false); });
    return () => { ++sequence.current; };
  }, [page, attempt]);

  async function revoke(row) {
    if (!(await confirm({ title: "撤销这个链接？", message: "撤销后链接永久失效，顾客将无法再打开。", confirmLabel: "撤销链接", danger: true }))) return;
    setBusy(true);
    try {
      const result = await createClient().rpc("revoke_catalog_link", { target_company: member.companyId, target_link: row.id });
      if (result.error) throw result.error;
      setLinks(prev => ({ ...prev, items: prev.items.map(item => item.id === row.id ? { ...item, revoked_at: new Date().toISOString() } : item) }));
      toast("链接已撤销");
    } catch (err) { toast(catalogLinkError(err.message)); }
    finally { setBusy(false); }
  }

  function go(next) {
    if (loading || next < 0) return;
    if (next > page) cursors.current[next] = links.cursor;
    setPage(next);
  }

  return (
    <main className="app-main">
      <TopBar title="分享" subtitle="顾客目录不显示价格，链接 7 天有效" actions={<RefreshButton busy={loading} onClick={() => setAttempt(n => n + 1)} />} />
      <div className="stack">
        <ContactCard profile={member} />
        <button type="button" className="btn btn-primary btn-block" onClick={onCreate}><Icon name="plus" size={20} />新建目录分享</button>
        {created && isActive(created) && <section className="card flat stack-sm">
          <div className="row"><Icon name="check" size={20} /><strong>链接已生成</strong><span className="small muted">到期 {day(created.expires_at)}</span></div>
          <p className="small" style={{ overflowWrap: "anywhere" }}>{linkUrl(created)}</p>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(created)}><Icon name="copy" size={16} />复制</button>
            <button type="button" className="btn btn-share btn-sm" onClick={() => void share(created)}><Icon name="send" size={16} />分享</button>
          </div>
        </section>}
        {error && <InlineError onRetry={() => setAttempt(n => n + 1)}>{error}</InlineError>}
        {loading ? <SkeletonList count={3} height={110} /> : !links.items.length
          ? <EmptyState icon="link" title="还没有分享链接" action={<button type="button" className="btn btn-secondary btn-sm" onClick={onCreate}>新建目录分享</button>} />
          : links.items.map(row => {
            const live = isActive(row);
            return (
              <article key={row.id} className={`card data-card${live ? "" : " muted-card"}`}>
                <div className="row-between">
                  <div className="title-line"><strong>{row.label || "目录链接"}</strong>
                    <span className={`pill ${row.revoked_at ? "pill-danger" : live ? "pill-green" : "pill-muted"}`}>{row.revoked_at ? "已撤销" : live ? "有效" : "已到期"}</span></div>
                  {live && <MoreMenu label="链接的更多操作" disabled={busy} items={[
                    { label: "打开顾客目录", icon: "external", onSelect: () => window.open(`/c/${row.token}`, "_blank", "noopener") },
                    { label: "撤销链接", icon: "trash", danger: true, onSelect: () => void revoke(row) }
                  ]} />}
                </div>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <span className="chip">{row.scope === "all" ? "全部公开产品" : `指定 ${row.product_ids.length} 项`}</span>
                  <span className="meta small">到期 {day(row.expires_at)}</span>
                </div>
                {admin && <p className="meta small">分享人：{row.seller_name}{row.created_by === member.userId ? "（我）" : ""}</p>}
                {live && <div className="btn-row" style={{ marginTop: 4 }}>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void copy(row)}><Icon name="copy" size={16} />复制</button>
                  <button type="button" className="btn btn-share btn-sm" disabled={busy} onClick={() => void share(row)}><Icon name="send" size={16} />分享</button>
                </div>}
              </article>
            );
          })}
        <Pager page={page} hasMore={links.hasMore} disabled={loading || busy} onPrev={() => go(page - 1)} onNext={() => go(page + 1)} />
        {admin && <Link href="/catalog-settings?tab=public" className="text-btn" style={{ justifySelf: "center" }}>管理哪些产品可以公开<Icon name="arrowRight" size={16} /></Link>}
      </div>
    </main>
  );
}

function ShareCreate({ onDone, onBack }) {
  const member = useMember(), confirm = useConfirm(), toast = useToast();
  const [scope, setScope] = useState("all"), [label, setLabel] = useState(""), [picked, setPicked] = useState({}), [showPicked, setShowPicked] = useState(false);
  const [query, setQuery] = useState(""), [products, setProducts] = useState({ items: [], has_more: false }), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0), cursors = useRef([null]), pending = useRef(null);
  const count = Object.keys(picked).length;
  const dirty = !!label.trim() || count > 0;
  const profileReady = !!member.displayName && !!member.whatsapp;

  useEffect(() => {
    if (scope !== "selected") return;
    const version = ++sequence.current;
    setLoading(true); setError("");
    const cursor = cursors.current[page];
    const timer = setTimeout(async () => {
      try {
        const result = await createClient().rpc("search_catalog_share_products", { target_company: member.companyId, search_text: query, after_created: cursor?.created_at || null, after_id: cursor?.id || null });
        if (result.error) throw result.error;
        if (version === sequence.current) setProducts(result.data);
      } catch (err) { if (version === sequence.current) setError(catalogLinkError(err.message)); }
      finally { if (version === sequence.current) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); ++sequence.current; };
  }, [scope, query, page]);

  useEffect(() => {
    const leave = event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, busy]);

  function pick(product, checked) {
    setPicked(prev => {
      const next = { ...prev };
      if (checked) {
        if (Object.keys(next).length >= 1000) { toast("最多选择 1000 项产品"); return prev; }
        next[product.id] = { serial: product.serial, name: product.name };
      } else delete next[product.id];
      return next;
    });
  }

  async function back() {
    if (dirty && !(await confirm({ title: "放弃这次分享？", message: "还没生成链接，已挑选的产品会被清空。", cancelLabel: "继续挑选", confirmLabel: "放弃", danger: true }))) return;
    onBack();
  }

  async function clearPicked() {
    if (await confirm({ title: "清空已选产品？", message: `将移除已选的 ${count} 项产品。`, confirmLabel: "清空", danger: true })) setPicked({});
  }

  async function submit() {
    if (busy) return;
    if (scope === "selected" && !count) { toast("请先挑选产品"); return; }
    setBusy(true); setError("");
    try {
      const ids = scope === "selected" ? Object.keys(picked).sort() : null, fingerprint = JSON.stringify([label.trim(), ids]);
      // Retry-safe: the same request id is reused until the inputs change.
      if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, request: newCatalogLinkRequest(member.companyId, label, ids) };
      const row = await createCatalogLink(createClient(), pending.current.request);
      pending.current = null;
      toast("链接已生成，有效 7 天");
      onDone(row);
    } catch (err) { setError(catalogLinkError(err.message)); }
    finally { setBusy(false); }
  }

  function go(next) {
    if (loading || next < 0) return;
    if (next > page) cursors.current[next] = products.cursor;
    setPage(next);
  }

  const candidates = products.items.filter(product => product.catalog_public);

  return (
    <main className="app-main">
      <TopBar title="新建目录分享" onBack={back} />
      <div className="stack">
        <div className="segmented" role="group" aria-label="分享范围">
          <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>全部公开产品</button>
          <button type="button" aria-pressed={scope === "selected"} onClick={() => setScope("selected")}>挑选产品</button>
        </div>
        <label className="field"><span className="field-label">链接名称（可选，只有内部看得到）</span>
          <input className="input" maxLength={120} value={label} placeholder="例如 Ali 的五金目录" onChange={e => setLabel(e.target.value)} /></label>
        <section className="card stack-sm">
          <p className="small muted">联系人</p>
          <p className="card-title">{member.displayName || "未设置姓名"} · {member.whatsapp || "未设置 WhatsApp"}</p>
          {!profileReady && <InlineError>请先填写 WhatsApp <Link href="/me/profile" className="text-btn">去填写</Link></InlineError>}
          <p className="small muted">有效期：7 天（固定）</p>
        </section>

        {scope === "selected" && <>
          <div className="sticky-top">
            <button type="button" className="btn btn-chip btn-block row-between" style={{ padding: "0 16px" }} aria-expanded={showPicked} onClick={() => setShowPicked(v => !v)}>
              <span>已选 {count} 项</span><Icon name="chevronDown" size={18} /></button>
            {showPicked && <div className="card stack-sm" style={{ marginTop: 8, maxHeight: 280, overflow: "auto" }}>
              {!count ? <p className="small muted">还没有挑选产品</p> : <>
                {Object.entries(picked).map(([id, p]) => <div key={id} className="row-between"><span className="small ellipsis">{p.serial} · {p.name}</span>
                  <button type="button" className="icon-btn" aria-label={`移除 ${p.serial}`} onClick={() => pick({ id }, false)}><Icon name="x" size={16} /></button></div>)}
                <button type="button" className="text-btn danger" onClick={clearPicked}>清空</button></>}
            </div>}
          </div>
          <SearchBox value={query} onChange={value => { cursors.current = [null]; setPage(0); setQuery(value); }} placeholder="搜索公开的产品" />
          {error && <InlineError>{error}</InlineError>}
          {loading ? <SkeletonList count={4} height={56} /> : !candidates.length
            ? <EmptyState title={query ? "没有符合的公开产品" : "这一页没有公开的产品"} />
            : <div className="list-card">{candidates.map(product => <label key={product.id} className="list-row" style={{ cursor: "pointer" }}>
              <span className="list-text"><span className="list-title" style={{ display: "block" }}>{product.name}</span><span className="list-desc">{product.serial}</span></span>
              <input type="checkbox" style={{ width: 22, height: 22, accentColor: "var(--navy)" }} checked={!!picked[product.id]} onChange={e => pick(product, e.target.checked)} aria-label={`选择 ${product.serial}`} />
            </label>)}</div>}
          <Pager page={page} hasMore={products.has_more} disabled={loading} onPrev={() => go(page - 1)} onNext={() => go(page + 1)} />
        </>}
        {scope === "all" && error && <InlineError>{error}</InlineError>}
      </div>
      <div className="sticky-actions">
        <button type="button" className="btn btn-primary btn-block" disabled={busy || !profileReady || (scope === "selected" && !count)} onClick={submit}>
          {busy ? "生成中…" : "生成 7 天链接"}</button>
      </div>
    </main>
  );
}
