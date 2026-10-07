"use client";
// ADM｜公司管理 — pages-spec §5. Admin-only entry to every company tool.
import Link from "next/link";
import { memberLabel } from "../../../lib/account-utils";
import { useMember } from "../../member-context";
import { EmptyState, TopBar } from "../../ui";
import Icon from "../../icons";

const GROUPS = [
  ["团队与业绩", [
    ["/team", "users", "员工管理", "邀请、停用员工，设置产品管理权限"],
    ["/team/report", "chart", "销售概览", "按员工查看报价、成交与收款"]
  ]],
  ["产品工具", [
    ["/catalog-settings?tab=categories", "tag", "产品分类", "新增、重命名、停用分类"],
    ["/catalog-settings?tab=numbers", "hash", "产品编号规则", "自动编号或必须手填"],
    ["/catalog-settings?tab=import", "upload", "批量新增产品", "用 CSV 一次新增多个产品"],
    ["/catalog-settings?tab=prices", "percent", "批量调价", "调价表或 CSV 文件"],
    ["/catalog-settings?tab=public", "globe", "产品公开设置", "决定哪些产品可放进顾客目录"]
  ]],
  ["公司与报价", [
    ["/brand", "palette", "公司资料与品牌", "公司名称、联系方式、Logo"],
    ["/brand?tab=defaults", "sliders", "报价默认设置", "编号前缀、有效天数、付款条款"]
  ]]
];

export default function Admin() {
  const member = useMember();
  if (member.role !== "admin") {
    return <main className="app-main"><TopBar title="公司管理" back="/me" />
      <EmptyState icon="lock" title="这个页面仅供公司管理员使用" action={<Link href="/cloud" className="btn btn-secondary btn-sm">回到产品目录</Link>} /></main>;
  }
  return (
    <main className="app-main">
      <TopBar title="公司管理" subtitle={`${member.name} · ${memberLabel(member)}`} back="/me" />
      <div className="stack">
        {GROUPS.map(([title, rows]) => <section key={title} className="stack-sm">
          <h2 className="small muted" style={{ fontWeight: 600 }}>{title}</h2>
          <nav className="list-card">
            {rows.map(([href, icon, name, desc]) => <Link key={href} href={href} className="list-row">
              <span className="list-icon"><Icon name={icon} size={20} /></span>
              <span className="list-text"><span className="list-title">{name}</span><br /><span className="list-desc">{desc}</span></span>
              <Icon name="chevronRight" size={18} />
            </Link>)}
          </nav>
        </section>)}
      </div>
    </main>
  );
}
