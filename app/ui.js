"use client";
// Shared components for the JomSales design system (docs/design-system.md §2).
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./icons";

/* ---------- Sheet (G.CLOSE + scrim, locks background scroll) ---------- */
let openSheets = 0;
function useBodyLock() {
  useEffect(() => {
    openSheets += 1; document.body.classList.add("sheet-open");
    return () => { openSheets -= 1; if (!openSheets) document.body.classList.remove("sheet-open"); };
  }, []);
}

export function Sheet({ title, subtitle, onClose, children, footer, bottom = false, className = "", closeLabel = "关闭" }) {
  const titleId = useId();
  const close = useRef(onClose); close.current = onClose;
  useBodyLock();
  useEffect(() => {
    const key = event => { if (event.key === "Escape") close.current?.(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <div className={`overlay${bottom ? " bottom" : ""}`} onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-head">
          <div className="grow">
            <h2 className="sheet-title" id={titleId}>{title}</h2>
            {subtitle && <p className="sheet-sub">{subtitle}</p>}
          </div>
          {onClose && <CloseButton onClick={onClose} label={closeLabel} />}
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function CloseButton({ onClick, label = "关闭" }) {
  return <button type="button" className="circle-btn sm" aria-label={label} onClick={onClick}><Icon name="x" size={18} strokeWidth={2.25} /></button>;
}

export function BackButton({ href, onClick, label = "返回" }) {
  const router = useRouter();
  return <button type="button" className="circle-btn" aria-label={label}
    onClick={onClick || (() => (href ? router.push(href) : router.back()))}><Icon name="arrowLeft" size={20} strokeWidth={2.25} /></button>;
}

/* ---------- G.TOPBAR ---------- */
export function TopBar({ title, subtitle, back, onBack, actions, divider = false }) {
  return (
    <header className={`topbar${divider ? " backbar" : ""}`}>
      {(back || onBack) && <BackButton href={typeof back === "string" ? back : undefined} onClick={onBack} />}
      <div className="grow">
        <h1 className="topbar-title">{title}</h1>
        {subtitle && <p className="topbar-sub">{subtitle}</p>}
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
    </header>
  );
}

export function RefreshButton({ onClick, busy, label = "刷新" }) {
  return <button type="button" className={`icon-btn${busy ? " spin" : ""}`} aria-label={label} disabled={busy} onClick={onClick}><Icon name="refresh" /></button>;
}

/* ---------- G.MORE ---------- */
export function MoreMenu({ items, label = "更多操作", up = false, disabled = false, icon = "more" }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = event => { if (!box.current?.contains(event.target)) setOpen(false); };
    const key = event => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); window.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", key); };
  }, [open]);
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <div className="menu-anchor" ref={box} onClick={event => event.stopPropagation()}>
      <button type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
        onClick={() => setOpen(value => !value)}><Icon name={icon} /></button>
      {open && <div className={`menu${up ? " up" : ""}`} role="menu">
        {visible.map(item => <button key={item.label} type="button" role="menuitem" className={`menu-item${item.danger ? " danger" : ""}`}
          disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }}>
          {item.icon && <Icon name={item.icon} size={18} />}{item.label}</button>)}
      </div>}
    </div>
  );
}

/* ---------- G.FILTER (single-choice dropdown, as in the Figma CAT frame) ---------- */
export function FilterMenu({ options, value, onChange, label = "筛选", disabled = false, active = false }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = event => { if (!box.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div className="menu-anchor" ref={box} style={{ position: "static" }}>
      <button type="button" className="filter-btn" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(v => !v)}>
        <Icon name="filter" size={20} />{label}{active && <span className="dot" />}
      </button>
      {open && <div className="dropdown-panel" role="listbox">
        {options.map(option => <button type="button" role="option" aria-selected={option.value === value} key={option.key ?? String(option.value)}
          className="menu-item" onClick={() => { setOpen(false); if (option.value !== value) onChange(option.value); }}>
          {option.label}{option.value === value && <Icon name="check" size={20} />}
        </button>)}
      </div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "搜索", label, disabled, maxLength = 240 }) {
  return (
    <div className="searchbox">
      <Icon name="search" size={20} />
      <input type="search" value={value} maxLength={maxLength} disabled={disabled} placeholder={placeholder}
        aria-label={label || placeholder} onChange={event => onChange(event.target.value)} enterKeyHint="search" />
      {value && <button type="button" className="icon-btn" aria-label="清除搜索" onClick={() => onChange("")}><Icon name="x" size={20} /></button>}
    </div>
  );
}

/* ---------- Password with show/hide (Figma Log In) ---------- */
export function PasswordInput({ id, value, onChange, placeholder = "密码", autoComplete = "current-password", disabled, minLength, maxLength = 128, invalid, label }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="input-group" aria-invalid={invalid || undefined}>
      <input id={id} className="input" type={shown ? "text" : "password"} value={value} placeholder={placeholder} aria-label={label}
        autoComplete={autoComplete} disabled={disabled} minLength={minLength} maxLength={maxLength} onChange={event => onChange(event.target.value)} />
      <button type="button" className="icon-btn" aria-label={shown ? "隐藏密码" : "显示密码"} aria-pressed={shown} onClick={() => setShown(v => !v)}>
        <Icon name={shown ? "eye" : "eyeOff"} size={20} /></button>
    </div>
  );
}

/* ---------- G.PAGE_* ---------- */
export function Pager({ page, hasMore, onPrev, onNext, disabled, label }) {
  if (!page && !hasMore) return null;
  return (
    <nav aria-label={label || "分页"}>
      <div className="pager">
        <button type="button" aria-label="上一页" disabled={disabled || !page} onClick={onPrev}><Icon name="arrowLeft" size={18} strokeWidth={2.25} /></button>
        <span className="page-no" aria-current="page">{page + 1}</span>
        <button type="button" aria-label="下一页" disabled={disabled || !hasMore} onClick={onNext}><Icon name="arrowRight" size={18} strokeWidth={2.25} /></button>
      </div>
      {label && <p className="pager-label">{label}</p>}
    </nav>
  );
}

/* ---------- States ---------- */
export function InlineError({ children, onRetry, retryLabel = "重试" }) {
  if (!children) return null;
  return <div className="inline-error" role="alert"><Icon name="alert" size={18} /><div className="grow">{children}{onRetry && <> <button type="button" className="text-btn" onClick={onRetry}>{retryLabel}</button></>}</div></div>;
}

export function EmptyState({ icon = "search", title, action }) {
  return <div className="empty-state"><Icon name={icon} size={40} /><p>{title}</p>{action}</div>;
}

export function SkeletonList({ count = 3, height = 72 }) {
  return <div className="stack-sm" aria-busy="true" aria-label="正在读取">{Array.from({ length: count }, (_, i) => <div key={i} className="skeleton" style={{ height }} />)}</div>;
}

export function SkeletonGrid({ count = 4 }) {
  return <div className="product-grid" aria-busy="true" aria-label="正在读取">{Array.from({ length: count }, (_, i) => <div key={i} className="skeleton" style={{ aspectRatio: "3 / 4" }} />)}</div>;
}

const statusPills = { pending: ["pill-warn", "待确认"], success: ["pill-navy", "已成交"], paid: ["pill-green", "已收款"] };
export function StatusPill({ status }) {
  const [className, text] = statusPills[status] || ["pill-muted", "未知"];
  return <span className={`pill ${className}`}>{text}</span>;
}

export function initials(name, email) {
  const text = String(name || email || "?").trim();
  return Array.from(text)[0] || "?";
}

/* ---------- D.DISCARD on leave: reload/close and in-app links ---------- */
export function useLeaveGuard(active, { title = "离开这个页面？", message = "还有没保存的修改，离开后会丢失。", blocked = false } = {}) {
  const confirm = useConfirm(), router = useRouter();
  const state = useRef({ active, blocked, title, message });
  state.current = { active, blocked, title, message };
  useEffect(() => {
    const leave = event => { if (state.current.active || state.current.blocked) { event.preventDefault(); event.returnValue = ""; } };
    const click = event => {
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || event.defaultPrevented || anchor.hasAttribute("download") || anchor.target === "_blank" || event.metaKey || event.ctrlKey) return;
      if (!state.current.active && !state.current.blocked) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault(); event.stopPropagation();
      // Work in progress (an import batch, a save) cannot be abandoned mid-request.
      if (state.current.blocked) return;
      void confirm({ title: state.current.title, message: state.current.message, cancelLabel: "留在这里", confirmLabel: "离开", danger: true })
        .then(ok => { if (ok) { state.current.active = false; router.push(url.pathname + url.search); } });
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", click, true); };
  }, [confirm, router]);
}

/* ---------- G.CONFIRM + G.TOAST providers ---------- */
const FeedbackContext = createContext(null);

export function FeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const confirm = useCallback(options => new Promise(resolve => {
    setDialog({ cancelLabel: "取消", confirmLabel: "确认", ...options, resolve });
  }), []);
  const notify = useCallback((message, options = {}) => {
    clearTimeout(timer.current);
    setToast({ message, ...options, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), options.duration || 2500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  function settle(value) { dialog?.resolve(value); setDialog(null); }

  return (
    <FeedbackContext.Provider value={{ confirm, notify }}>
      {children}
      {dialog && <Sheet title={dialog.title} onClose={() => settle(false)} className="dialog" footer={
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={() => settle(false)}>{dialog.cancelLabel}</button>
          <button type="button" className={`btn ${dialog.danger ? "btn-danger-solid" : "btn-primary"}`} autoFocus onClick={() => settle(true)}>{dialog.confirmLabel}</button>
        </div>}>
        {dialog.message && <p>{dialog.message}</p>}
      </Sheet>}
      {toast && <div className="toast-wrap" aria-live="polite"><div className="toast" key={toast.id} role="status">
        <span>{toast.message}</span>
        {toast.action && <button type="button" onClick={() => { clearTimeout(timer.current); setToast(null); toast.action.onClick(); }}>{toast.action.label}</button>}
      </div></div>}
    </FeedbackContext.Provider>
  );
}

const fallback = { confirm: async options => window.confirm([options.title, options.message].filter(Boolean).join("\n")), notify: () => {} };
export function useConfirm() { return (useContext(FeedbackContext) || fallback).confirm; }
export function useToast() { return (useContext(FeedbackContext) || fallback).notify; }
