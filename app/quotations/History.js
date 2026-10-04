"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useCompanyScope from "../use-company-scope";
import { createClient } from "../../lib/supabase/client";
import { listQuotations } from "../../lib/supabase/workspace";
function List({ context }) {
  const [rows, setRows] = useState([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  async function load() {
    const version = ++sequence.current; setLoading(true); setError(""); setRows([]);
    try { const result = await listQuotations(createClient(), context.companyId); if (version === sequence.current) setRows(result); }
    catch (err) { if (version === sequence.current) setError(err.message); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { ++sequence.current; }; }, []);
  return <>
    <Link href={`/cloud?company=${context.companyId}`}>← 公司产品目录</Link><h1>已保存报价</h1>
    <p>{context.name} · {context.role === "admin" ? "管理员可以查看并编辑本公司的所有报价。" : "销售员只可查看和编辑自己创建的报价。"}</p>
    <Link href={`/cloud?company=${context.companyId}&new=1`}>新建报价</Link> <button disabled={loading} onClick={load}>刷新报价列表</button>
    {loading && <p role="status">正在读取…</p>}{error && <p role="alert" className="accountError">{error}</p>}
    {!loading && !error && !rows.length && <p>暂时没有已保存报价。</p>}
    {rows.map(row => <article className="accountCard" key={row.id}>
      <strong>{row.number}</strong><p>{row.customer_name || "未填写客户"} · {row.quote_date}</p>
      <p>创建员工：{row.created_by === context.userId ? "我" : row.created_by}</p>
      <Link href={`/cloud?company=${context.companyId}&quote=${row.id}`}>打开 / 修改报价</Link>
    </article>)}
  </>;
}
export default function History() {
  const { context, error } = useCompanyScope();
  return <main className="page accountPage">{error && <p role="alert">{error}</p>}{context ? <List key={`${context.userId}:${context.companyId}:${context.role}`} context={context} /> : <p>正在确认公司访问权限… <Link href="/account">公司账号</Link></p>}</main>;
}
