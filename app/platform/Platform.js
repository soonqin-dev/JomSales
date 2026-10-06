"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { newInviteToken } from "../../lib/supabase/invitations";
import { nullableLimit, memberLabel } from "../../lib/account-utils";

const states = { trial: "试用", active: "正常", expired: "到期", suspended: "停用" };
const dateInput = date => date ? new Date(new Date(date).getTime() - new Date(date).getTimezoneOffset() * 60000).toISOString().slice(0,16) : "";

export default function Platform() {
  const [allowed, setAllowed] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [rows, setRows] = useState([]);
  const [search, setSearch] = useState(""), [offset, setOffset] = useState(0);
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [invite, setInvite] = useState(null);
  const [selected, setSelected] = useState(null), [draft, setDraft] = useState(null), [members, setMembers] = useState([]), [audit, setAudit] = useState([]);
  const [primaryEmail, setPrimaryEmail] = useState("");
  const sequence = useRef(0), working = useRef(false), identity = useRef(null), pending = useRef(null);
  const fail = error => { if (error) throw error; };
  async function rpc(client, method, args) { const result = await client.rpc(method, args); fail(result.error); return result.data; }
  async function load(nextOffset = offset, afterOperation = false) {
    if (working.current && !afterOperation) return;
    const version = ++sequence.current; setLoading(true); setError("");
    try {
      const client = createClient(), auth = await client.auth.getUser();
      if (auth.error || !auth.data.user) { window.location.replace("/account"); return; }
      if (identity.current && identity.current !== auth.data.user.id) throw new Error("账号已改变，请重新登录。");
      identity.current = auth.data.user.id;
      if (await rpc(client, "is_platform_admin") !== true) throw new Error("此账号没有平台权限，或尚未通过所需双重验证。");
      const data = await rpc(client, "platform_list_companies", { search_text: search.trim(), page_offset: nextOffset });
      if (version !== sequence.current) return;
      setAllowed(true); setRows(data || []); setOffset(nextOffset);
    } catch (err) {
      if (version === sequence.current) { setAllowed(false); setRows([]); setSelected(null); setDraft(null); setMembers([]); setAudit([]); setInvite(null); setError(err.message); }
    } finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    void load(0);
    const subscription = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (identity.current && session?.user.id !== identity.current)) {
        ++sequence.current; setAllowed(false); setRows([]); setMembers([]); setAudit([]); setDraft(null); setInvite(null); pending.current = null; window.location.replace("/account");
      }
    }).data.subscription;
    return () => { ++sequence.current; subscription.unsubscribe(); };
  }, []);
  async function run(task) {
    if (working.current || !allowed || loading) return;
    working.current = true; setBusy(true); setError(""); setMessage("");
    const version = sequence.current;
    try {
      const client = createClient();
      const text = await task(client);
      if (version !== sequence.current) return;
      setMessage(text || "操作完成。");
      await load(offset, true);
    } catch (err) { if (version === sequence.current) setError(`操作未确认：${err.message}。请核对记录后重试。`); }
    finally { working.current = false; setBusy(false); }
  }
  function edit(row) {
    void run(async client => {
      const [team, records] = await Promise.all([
        rpc(client, "platform_company_members", { target_company: row.id }), rpc(client, "platform_audit_list", { target_company: row.id })
      ]);
      setSelected(row); setMembers(team || []); setAudit(records || []); setPrimaryEmail("");
      setDraft({ state: row.service_state, until: dateInput(row.service_until), plan: row.plan,
        seats: row.employee_limit ?? "", products: row.product_limit ?? "", storage: row.storage_limit_mb ?? "", features: JSON.stringify(row.features || {}, null, 2) });
      return "";
    });
  }
  function memberAction(member, action, label) {
    if (!window.confirm(`${label} ${member.display_name || member.email}？历史资料保留；更换正管理员会使原正管理员成为副管理员。`)) return;
    void run(async client => {
      await rpc(client, "platform_manage_member", { target_company: selected.id, employee_id: member.user_id, action });
      setMembers(await rpc(client, "platform_company_members", { target_company: selected.id }));
      setAudit(await rpc(client, "platform_audit_list", { target_company: selected.id }));
      return `${label}已完成。`;
    });
  }
  function showInvite(request) {
    setInvite({ company: request.name || selected?.name, email: request.email, url: `${window.location.origin}/join#token=${request.token}` });
    pending.current = null;
  }
  return <main className="page accountPage">
    <Link href="/account">← 账号</Link><h1>JomSales 平台后台</h1>
    {loading && <p role="status">正在检查平台权限…</p>}{error && <p role="alert" className="accountError">{error}</p>}{message && <p role="status">{message}</p>}
    {!allowed && !loading && <><p><Link href="/settings">个人设置／双重验证</Link></p><button onClick={() => void load(0)}>重新检查权限</button></>}
    {allowed && <>
      <section className="accountCard"><h2>开通公司</h2><form onSubmit={e => { e.preventDefault(); void run(async client => {
        const normalized = email.trim().toLowerCase(), companyName = name.trim();
        if (!pending.current || pending.current.kind !== "create" || pending.current.email !== normalized || pending.current.name !== companyName) {
          pending.current = { kind: "create", id: crypto.randomUUID(), name: companyName, email: normalized, token: newInviteToken() };
        }
        const request = pending.current;
        await rpc(client, "platform_create_company", { target_company: request.id, company_name: request.name, admin_email: request.email, invite_token: request.token });
        showInvite(request); setName(""); setEmail("");
        return "公司已建立。请把邀请链接发给正管理员，由对方注册／登录并设置自己的密码。";
      }); }}>
        <label htmlFor="new-company">公司名称</label><input id="new-company" required maxLength={120} value={name} disabled={busy || loading} onChange={e => setName(e.target.value)} />
        <label htmlFor="primary-email">正管理员邮箱</label><input id="primary-email" type="email" required maxLength={254} value={email} disabled={busy || loading} onChange={e => setEmail(e.target.value)} />
        <button disabled={busy || loading}>开通并生成管理员邀请</button>
      </form></section>
      {invite && <section className="accountCard"><h2>管理员邀请</h2><p>{invite.company} · {invite.email} · 7 天有效，尚未自动发送</p>
        <input aria-label="管理员邀请链接" readOnly value={invite.url} onFocus={e => e.target.select()} />
        <button disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(invite.url); setMessage("链接已复制。"); } catch { setMessage("请手动选择并复制链接。"); } }}>复制链接</button>
      </section>}
      <section className="accountCard"><h2>公司</h2><form onSubmit={e => { e.preventDefault(); void load(0); }}>
        <label htmlFor="company-search">查询公司</label><input id="company-search" maxLength={120} value={search} disabled={busy || loading} onChange={e => setSearch(e.target.value)} /><button disabled={busy || loading}>查询</button>
      </form>
        {!loading && !rows.length && <p>没有符合条件的公司。</p>}
        {rows.map(row => <div className="teamRow" key={row.id}><div><strong>{row.name}</strong><p>{row.plan} · {states[row.service_state]}{row.service_until && ` · 截止 ${new Date(row.service_until).toLocaleString()}`}</p><p>正管理员：{row.admin_email || "待接受邀请／待指定"}</p><p>成员 {row.members} · 产品 {row.products} · 图片用量约 {(Number(row.storage_bytes) / 1048576).toFixed(1)} MB</p></div><button disabled={busy || loading} onClick={() => edit(row)}>管理公司</button></div>)}
        <div className="cloudButtons"><button disabled={busy || loading || !offset} onClick={() => void load(Math.max(0, offset - 50))}>上一页</button><span>第 {offset / 50 + 1} 页</span><button disabled={busy || loading || rows.length < 50} onClick={() => void load(offset + 50)}>下一页</button></div>
      </section>
      {selected && draft && <section className="accountCard"><h2>{selected.name} · 设置</h2>
        <form onSubmit={e => { e.preventDefault(); if (!window.confirm("保存配套和访问设置？停用、到期或已过服务期限会阻止公司访问，资料不会删除。")) return;
          void run(async client => {
            const features = JSON.parse(draft.features);
            if (!features || Array.isArray(features) || typeof features !== "object") throw new Error("功能配置需为 JSON 对象。");
            await rpc(client, "platform_update_company", { target_company: selected.id, expected_revision: selected.access_revision,
              new_state: draft.state, new_until: draft.until ? new Date(draft.until).toISOString() : null, new_plan: draft.plan,
              seats: nullableLimit(draft.seats), product_cap: nullableLimit(draft.products), storage_mb: nullableLimit(draft.storage), feature_config: features });
            setSelected(null); setDraft(null); setMembers([]); setAudit([]); return "公司设置已保存。";
          });
        }}>
          <label htmlFor="service-state">服务状态</label><select id="service-state" value={draft.state} disabled={busy} onChange={e => setDraft({ ...draft, state: e.target.value })}>{Object.entries(states).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
          <label htmlFor="service-until">服务截止时间（本地时间，留空不设期限）</label><input id="service-until" type="datetime-local" value={draft.until} disabled={busy} onChange={e => setDraft({ ...draft, until: e.target.value })} />
          <label htmlFor="plan-name">配套</label><select id="plan-name" value={draft.plan} disabled={busy} onChange={e => setDraft({ ...draft, plan: e.target.value })}>{["Lite","Pro","Premium","Customize"].map(plan => <option key={plan}>{plan}</option>)}</select>
          <label htmlFor="seat-limit">成员额度（含管理员及停用成员；留空不限制）</label><input id="seat-limit" type="number" min={1} max={100000} value={draft.seats} disabled={busy} onChange={e => setDraft({ ...draft, seats: e.target.value })} />
          <label htmlFor="product-cap">产品额度（留空不限制；超过额度不删除旧产品）</label><input id="product-cap" type="number" min={1} max={10000000} value={draft.products} disabled={busy} onChange={e => setDraft({ ...draft, products: e.target.value })} />
          <details><summary>预留配套配置</summary><p>容量和功能配置暂只保存，尚未作为对应功能的收费限制。</p>
            <label htmlFor="storage-cap">图片额度（MB）</label><input id="storage-cap" type="number" min={1} max={100000000} value={draft.storage} disabled={busy} onChange={e => setDraft({ ...draft, storage: e.target.value })} />
            <label htmlFor="feature-config">功能配置（JSON，预留）</label><textarea id="feature-config" maxLength={3000} rows={4} value={draft.features} disabled={busy} onChange={e => setDraft({ ...draft, features: e.target.value })} />
          </details><button disabled={busy || loading}>保存公司设置</button>
        </form>
        <h3>成员管理</h3>
        {members.map(member => <div className="teamRow" key={member.user_id}><div><strong>{member.display_name || member.email}</strong><p>{member.email} · {memberLabel(member)} · {member.removed_at ? "已移除" : member.active ? "有效" : "停用"}</p></div>
          {!member.removed_at && !member.is_primary && <div className="cloudButtons">
            <button disabled={busy || loading} onClick={() => memberAction(member, member.active ? "disable" : "enable", member.active ? "停用成员" : "恢复成员")}>{member.active ? "停用" : "恢复"}</button>
            <button disabled={busy || loading} onClick={() => memberAction(member, "remove", "移除成员")}>移除</button>
            <button disabled={busy || loading || !member.active} onClick={() => memberAction(member, "make_primary", "更换为正管理员")}>设为正管理员</button>
          </div>}
        </div>)}
        {!members.some(member => member.is_primary) && <form onSubmit={e => { e.preventDefault(); void run(async client => {
          const normalized = primaryEmail.trim().toLowerCase();
          if (!pending.current || pending.current.kind !== "primary" || pending.current.id !== selected.id || pending.current.email !== normalized) pending.current = { kind: "primary", id: selected.id, email: normalized, token: newInviteToken() };
          const request = pending.current;
          await rpc(client, "platform_primary_invite", { target_company: selected.id, admin_email: request.email, invite_token: request.token });
          showInvite(request); return "新的正管理员邀请已生成，之前未接受的管理员邀请已撤销。";
        }); }}><label htmlFor="replacement-email">首次／重新邀请正管理员邮箱</label><input id="replacement-email" type="email" required maxLength={254} value={primaryEmail} disabled={busy} onChange={e => setPrimaryEmail(e.target.value)} /><button disabled={busy || loading}>生成管理员邀请</button></form>}
        <details><summary>最近操作记录</summary>{audit.map(record => <p key={record.id}>{new Date(record.created_at).toLocaleString()} · {record.action}<br />{JSON.stringify(record.details)}</p>)}</details>
      </section>}
    </>}
  </main>;
}
