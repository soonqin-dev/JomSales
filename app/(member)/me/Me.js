"use client";
// ME｜我的 — docs/pages-spec.md §3.
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { memberLabel } from "../../../lib/account-utils";
import { useCurrentQuote, useMember } from "../../member-context";
import { Sheet, TopBar, initials, useConfirm, useToast } from "../../ui";
import Icon from "../../icons";
import pkg from "../../../package.json";

export default function Me() {
  const member = useMember(), quote = useCurrentQuote();
  const confirm = useConfirm(), toast = useToast();
  const [platform, setPlatform] = useState(false), [picker, setPicker] = useState(false), [busy, setBusy] = useState(false);
  const admin = member.role === "admin";

  useEffect(() => {
    let cancelled = false;
    createClient().rpc("is_platform_admin").then(result => { if (!cancelled) setPlatform(!result.error && result.data === true); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // D.LOGOUT: leaving discards the in-memory quote.
  async function logout() {
    if ((quote.dirty || quote.items?.length) && !(await confirm({ title: "退出登录？", message: "退出会放弃当前报价。", confirmLabel: "退出", danger: true }))) return;
    setBusy(true);
    try {
      const result = await createClient().auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
      window.location.replace("/account");
    } catch (err) { toast(`退出失败：${err.message}`); setBusy(false); }
  }

  return (
    <main className="app-main">
      <TopBar title="我的" />
      <div className="stack">
        <section className="card row" style={{ gap: 14 }}>
          <span className="avatar lg" aria-hidden="true">{initials(member.displayName, member.email)}</span>
          <div className="grow">
            <p className="card-title">{member.displayName}</p>
            <p className="small muted ellipsis">{member.email}</p>
            <span className="chip" style={{ marginTop: 6 }}>{memberLabel(member)}</span>
          </div>
        </section>

        {admin && <section className="stack-sm" aria-label="管理员快捷入口">
          <div className="quick-grid">
            <Link href="/team/report" className="quick-card"><Icon name="chart" size={26} /><strong>销售概览</strong></Link>
            <Link href="/team" className="quick-card"><Icon name="users" size={26} /><strong>员工管理</strong></Link>
          </div>
          <Link href="/admin" className="text-btn" style={{ justifySelf: "end" }}>更多公司设置<Icon name="arrowRight" size={16} /></Link>
        </section>}

        <section className="card row-between">
          <div className="grow"><p className="small muted">当前公司</p><p className="card-title ellipsis">{member.name}</p></div>
          {member.memberships.length > 1 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPicker(true)}>切换公司</button>}
        </section>

        <nav className="list-card" aria-label="账号">
          <Link href="/me/profile" className="list-row"><span className="list-icon"><Icon name="user" size={20} /></span>
            <span className="list-text"><span className="list-title">个人资料</span><br /><span className="list-desc">姓名与工作 WhatsApp</span></span><Icon name="chevronRight" size={18} /></Link>
          <Link href="/me/security" className="list-row"><span className="list-icon"><Icon name="lock" size={20} /></span>
            <span className="list-text"><span className="list-title">账号安全</span><br /><span className="list-desc">密码、邮箱与双重验证</span></span><Icon name="chevronRight" size={18} /></Link>
          {platform && <Link href="/platform" className="list-row"><span className="list-icon"><Icon name="shield" size={20} /></span>
            <span className="list-text"><span className="list-title">平台管理</span></span><Icon name="chevronRight" size={18} /></Link>}
        </nav>

        <button type="button" className="btn btn-danger btn-block" disabled={busy} onClick={logout}><Icon name="logout" size={20} />退出登录</button>
        <p className="small muted" style={{ textAlign: "center" }}>JomSales v{pkg.version}</p>
      </div>

      {picker && <Sheet title="切换公司" onClose={() => setPicker(false)}>
        <div className="list-card">
          {member.memberships.map(m => <button key={m.company_id} type="button" className="list-row" onClick={async () => { setPicker(false); await member.switchCompany(m.company_id); }}>
            <span className="list-icon"><Icon name="building" size={20} /></span>
            <span className="list-text"><span className="list-title">{m.companies?.name}</span></span>
            {m.company_id === member.companyId && <Icon name="check" />}
          </button>)}
        </div>
      </Sheet>}
    </main>
  );
}
