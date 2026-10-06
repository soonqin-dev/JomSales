"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { companyProfileReady,companyProfileSetupUrl } from "../lib/supabase/company-profile";

// Every secondary workspace screen revalidates live company membership.
export default function useCompanyScope(adminOnly = false) {
  const [context, setContext] = useState(null), [error, setError] = useState("");
  const sequence = useRef(0), identity = useRef(null);
  useEffect(() => {
    let timer, subscription;
    async function check() {
      const version = ++sequence.current;
      try {
        const client = createClient(), auth = await client.auth.getUser();
        if (version !== sequence.current) return;
        if (auth.error && auth.error.name !== "AuthSessionMissingError" && ![401,403].includes(auth.error.status)) throw auth.error;
        if (auth.error || !auth.data.user) { setContext(null); window.location.replace("/account"); return; }
        if (identity.current && identity.current !== auth.data.user.id) { setContext(null); window.location.replace("/account"); return; }
        identity.current = auth.data.user.id;
        const result = await client.from("company_members").select("company_id,role,companies(id,name)").eq("user_id", identity.current).eq("active", true);
        if (result.error) throw result.error;
        if (version !== sequence.current) return;
        const id = new URLSearchParams(window.location.search).get("company") || result.data?.[0]?.company_id;
        const member = result.data?.find(m => m.company_id === id);
        if (!member?.companies || (adminOnly && member.role !== "admin")) {
          setContext(null);
          throw new Error(adminOnly ? "此页面仅供该公司管理员使用。" : "公司访问权限不可用或已停用。");
        }
        const ready=await companyProfileReady(client,identity.current);
        if(version!==sequence.current)return;
        if(!ready){setContext(null);window.location.replace(companyProfileSetupUrl(id,window.location.pathname+window.location.search));return;}
        setContext(prev => prev?.companyId === id && prev.role === member.role ? prev : { companyId: id, userId: identity.current, role: member.role, name: member.companies.name });
        setError("");
      } catch (err) { if (version === sequence.current) setError(`权限／网络检查失败：${err.message}`); }
    }
    try {
      subscription = createClient().auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || (identity.current && session?.user.id !== identity.current)) {
          ++sequence.current; setContext(null); window.location.replace("/account");
        }
        if (event === "SIGNED_IN") { clearTimeout(timer); timer = setTimeout(check, 0); }
      }).data.subscription;
      void check();
    } catch (err) { setError(err.message); }
    const interval = setInterval(check, 120000); window.addEventListener("focus", check);
    return () => { ++sequence.current; clearTimeout(timer); clearInterval(interval); subscription?.unsubscribe(); window.removeEventListener("focus", check); };
  }, [adminOnly]);
  return { context, error };
}
