"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";

// Shared presentation primitives. Data, permissions and workflows stay with each page.
const assets = {
  profile: ["profile", 24, 24], quotation: ["quotation", 24, 24],
  search: ["search", 11, 11], add: ["add", 14, 14],
};
export function DesignIcon({ name }) {
  const [file, width, height] = assets[name];
  return <img className={`designIcon icon-${name}`} src={`/figma/${file}.svg`} width={width} height={height} alt="" aria-hidden="true" />;
}
export function Button({ children, className = "", variant = "secondary", type = "button", ...props }) {
  return <button type={type} className={`uiButton uiButton-${variant} ${className}`} {...props}>{children}</button>;
}
export function NavLink({ children, href, className = "", ...props }) {
  return <Link className={`uiButton uiButton-secondary ${className}`} href={href} {...props}>{children}</Link>;
}
export function PageHeader({ title, subtitle, icon = "quotation", children }) {
  return <header className="pageHeader">
    <div className="headerIdentity"><span className="headerIcon"><DesignIcon name={icon} /></span>
      <div><div className="eyebrow">SALESGO</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    </div>{children}
  </header>;
}
export function Panel({ children, title, id, className = "" }) {
  return <section className={`uiPanel ${className}`} aria-labelledby={title ? id : undefined}>
    {title && <h2 id={id}>{title}</h2>}{children}
  </section>;
}
export function Status({ children, error = false }) {
  if (!children) return null;
  return <p className={error ? "accountError" : "uiStatus"} role={error ? "alert" : "status"}>{children}</p>;
}
export function EmptyState({ title, children }) {
  return <div className="empty"><span className="emptyMark" aria-hidden="true">—</span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function FloatingAction({ home = false, count, children, className = "", ...props }) {
  return <div className="floatingDock"><button type="button" className={`floatingAction ${className}`} {...props}>
    <img src={`/figma/${home ? "home-fab" : "quotation-fab"}.svg`} width="46" height="46" alt="" />
    {count !== undefined && <span className="floatingCount"><img src="/figma/count.svg" width="17" height="17" alt="" /><span>{count}</span></span>}
    <span className="srOnly" aria-live={count !== undefined ? "polite" : undefined}>{children}</span>
  </button><span className="floatingCaption" aria-hidden="true">{home ? "产品目录" : "报价清单"}</span></div>;
}
export function Modal({ children, labelledBy, locked, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current, previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog ref={ref} className="sheet productDialog productFormDialog" aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || locked) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>{children}</dialog>;
}
