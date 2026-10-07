"use client";
// Member shell: verified company scope + the current quotation (FLOW.QUOTE_CONTINUE)
// live in the (member) layout, so client-side page changes keep the draft in memory.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { completeCompanyProfile } from "../lib/account-utils";
import { companyProfileSetupUrl } from "../lib/supabase/company-profile";
import useCloudQuotation from "./use-cloud-quotation";
import Icon from "./icons";
import { InlineError, useConfirm } from "./ui";

const MemberContext = createContext(null);
const QuoteContext = createContext(null);

export function useMember() { return useContext(MemberContext); }
export function useCurrentQuote() { return useContext(QuoteContext); }

const MEMBER_COLUMNS = "company_id,role,is_primary,can_manage_products,companies(id,name)";

export default function MemberProvider({ children }) {
  const [context, setContext] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const scope = useRef(null), sequence = useRef(0), identity = useRef(null), chosen = useRef(null);
  const quoteRef = useRef(null);
  const confirm = useConfirm();
  const router = useRouter(), pathname = usePathname();

  const check = useCallback(async () => {
    const version = ++sequence.current;
    try {
      const client = createClient(), auth = await client.auth.getUser();
      if (version !== sequence.current) return;
      if (auth.error && auth.error.name !== "AuthSessionMissingError" && ![401, 403].includes(auth.error.status)) throw auth.error;
      const user = auth.data?.user;
      if (auth.error || !user || (identity.current && identity.current !== user.id)) { scope.current = null; setContext(null); window.location.replace("/account"); return; }
      identity.current = user.id;
      const [members, profile] = await Promise.all([
        client.from("company_members").select(MEMBER_COLUMNS).eq("user_id", user.id).eq("active", true),
        client.from("account_profiles").select("display_name,whatsapp").eq("user_id", user.id).maybeSingle()
      ]);
      if (members.error) throw members.error;
      if (profile.error) throw profile.error;
      if (version !== sequence.current) return;
      const rows = members.data || [];
      if (!rows.length) { scope.current = null; setContext(null); window.location.replace("/account"); return; }
      const requested = chosen.current || new URLSearchParams(window.location.search).get("company");
      const member = rows.find(m => m.company_id === requested) || (requested ? null : rows[0]);
      if (!member?.companies) { scope.current = null; setContext(null); throw new Error("公司访问权限不可用或已停用。请到「我的」切换公司，或联系公司管理员。"); }
      if (!completeCompanyProfile(profile.data)) {
        scope.current = null; setContext(null);
        window.location.replace(companyProfileSetupUrl(member.company_id, window.location.pathname + window.location.search)); return;
      }
      chosen.current = member.company_id;
      const next = {
        userId: user.id, email: user.email || "", displayName: profile.data.display_name.trim(), whatsapp: profile.data.whatsapp || "",
        companyId: member.company_id, name: member.companies.name, role: member.role, is_primary: member.is_primary === true,
        can_manage_products: member.can_manage_products === true, memberships: rows
      };
      const prev = scope.current;
      const same = prev && JSON.stringify(prev) === JSON.stringify(next);
      if (!same) { scope.current = next; setContext(next); }
      setError("");
    } catch (err) {
      if (version === sequence.current) setError(`无法确认公司权限：${err.message}`);
    } finally { if (version === sequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    let timer, subscription;
    try {
      subscription = createClient().auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || (identity.current && session && session.user.id !== identity.current)) {
          ++sequence.current; scope.current = null; setContext(null); window.location.replace("/account");
        }
        if (event === "SIGNED_IN") { clearTimeout(timer); timer = setTimeout(check, 0); }
      }).data.subscription;
    } catch (err) { setError(err.message); setLoading(false); }
    void check();
    // Recheck live membership; RLS still authorizes every request on its own.
    const interval = setInterval(check, 120000);
    window.addEventListener("focus", check);
    return () => { ++sequence.current; clearTimeout(timer); clearInterval(interval); subscription?.unsubscribe(); window.removeEventListener("focus", check); };
  }, [check]);

  // D.COMPANY_CHANGE: switching company discards the in-memory quote.
  const switchCompany = useCallback(async companyId => {
    if (!scope.current || companyId === scope.current.companyId) return false;
    const quote = quoteRef.current;
    if ((quote?.dirty || quote?.items?.length) && !(await confirm({ title: "切换公司？", message: "切换公司会放弃当前报价。", cancelLabel: "留在这里", confirmLabel: "放弃并切换", danger: true }))) return false;
    chosen.current = companyId; setLoading(true);
    router.replace(`${pathname}?company=${companyId}`);
    await check();
    return true;
  }, [check, confirm, pathname, router]);

  const refresh = useCallback(() => check(), [check]);

  if (!context) {
    return <main className="app-main no-nav">
      {loading && !error ? <div className="stack" aria-busy="true"><div className="skeleton" style={{ height: 64 }} /><div className="skeleton" style={{ height: 44 }} /><div className="skeleton" style={{ height: 240 }} /></div>
        : <div className="stack"><InlineError onRetry={() => { setLoading(true); void check(); }} retryLabel="重新检查">{error || "正在确认公司访问权限…"}</InlineError>
          <Link className="btn btn-secondary" href="/account">返回账号页</Link></div>}
    </main>;
  }

  return (
    <MemberContext.Provider value={{ ...context, switchCompany, refresh }}>
      <QuoteScope key={`${context.userId}:${context.companyId}`} context={context} quoteRef={quoteRef}>
        {error && <div className="app-main" style={{ minHeight: 0, paddingBottom: 0 }}><InlineError onRetry={refresh}>{error}</InlineError></div>}
        {children}
        <NavBar />
      </QuoteScope>
    </MemberContext.Provider>
  );
}

function QuoteScope({ context, quoteRef, children }) {
  const quotation = useCloudQuotation(context);
  // CAT.LAST_PDF: the last completed file stays available after the quote resets.
  const [lastPdf, setLastPdf] = useState(null);
  const value = { ...quotation, lastPdf, setLastPdf };
  quoteRef.current = value;
  return <QuoteContext.Provider value={value}>{children}</QuoteContext.Provider>;
}

const tabs = [
  { href: "/cloud", label: "产品", icon: "bag", match: p => p === "/cloud" },
  { href: "/customers", label: "客户", icon: "phone", match: p => p.startsWith("/customers") },
  { href: "/cloud/quote", label: "报价单", icon: "doc", match: p => p.startsWith("/cloud/quote") || p.startsWith("/quotations"), badge: true },
  { href: "/catalog-share", label: "分享", icon: "send", match: p => p.startsWith("/catalog-share") },
  { href: "/me", label: "我的", icon: "user", match: p => ["/me", "/admin", "/team", "/brand", "/catalog-settings", "/settings"].some(prefix => p.startsWith(prefix)) }
];

function NavBar() {
  const pathname = usePathname() || "";
  const quote = useCurrentQuote();
  const count = quote?.items?.length || 0;
  return (
    <nav className="navbar" aria-label="主导航">
      {tabs.map(tab => {
        const active = tab.match(pathname);
        return <Link key={tab.href} href={tab.href} className="nav-item" aria-current={active ? "page" : undefined}>
          <span className="nav-icon"><Icon name={tab.icon} size={22} />
            {tab.badge && count > 0 && <span className="nav-badge" aria-label={`当前报价 ${count} 项`}>{count > 99 ? "99+" : count}</span>}</span>
          {tab.label}
        </Link>;
      })}
    </nav>
  );
}
