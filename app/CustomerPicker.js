"use client";
// CPK｜选择客户 — daily-flow-spec §7. Only active, accessible customers are listed.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { listCustomers } from "../lib/supabase/customers";
import { EmptyState, InlineError, Pager, SearchBox, Sheet, SkeletonList } from "./ui";
import Icon from "./icons";

const PAGE = 50;

export default function CustomerPicker({ context, onSelect, onClose }) {
  const router = useRouter();
  const [search, setSearch] = useState(""), [rows, setRows] = useState([]), [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    const version = ++sequence.current;
    setLoading(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const data = await listCustomers(createClient(), context.companyId, search, false, offset);
        if (version === sequence.current) { setRows(data.items); setTotal(Number(data.total)); }
      } catch (err) { if (version === sequence.current) setError(`客户读取失败：${err.message}`); }
      finally { if (version === sequence.current) setLoading(false); }
    }, 250);
    return () => { ++sequence.current; clearTimeout(timer); };
  }, [search, offset, context.companyId, attempt]);

  return (
    <Sheet title="选择客户" subtitle="选用后会填入本张报价，之后可单独修改" onClose={onClose} footer={
      <button type="button" className="text-btn" style={{ justifySelf: "center" }} onClick={() => { onClose(); router.push("/customers"); }}>
        管理客户<Icon name="arrowRight" size={16} /></button>}>
      <SearchBox value={search} onChange={value => { setSearch(value); setOffset(0); }} placeholder="搜索姓名、公司、电话" />
      {error && <InlineError onRetry={() => setAttempt(value => value + 1)}>{error}</InlineError>}
      {loading ? <SkeletonList count={4} height={56} /> : !rows.length ? (
        <EmptyState icon="phone" title={search ? "没有符合的客户" : "还没有客户"} action={!search &&
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onClose(); router.push("/customers?new=1"); }}>去新增客户</button>} />
      ) : (
        <div className="list-card">
          {rows.map(row => <button key={row.id} type="button" className="list-row" onClick={() => { onSelect(row); onClose(); }}>
            <span className="list-text">
              <span className="list-title" style={{ display: "block" }}>{row.name}</span>
              <span className="list-desc" style={{ display: "block" }}>{[row.company, row.phone].filter(Boolean).join(" · ") || "—"}</span>
              {context.role === "admin" && <span className="list-desc" style={{ display: "block" }}>建立者：{row.owner_name || row.owner_email || "—"}</span>}
            </span>
            <Icon name="chevronRight" size={18} />
          </button>)}
        </div>
      )}
      <Pager page={Math.floor(offset / PAGE)} hasMore={offset + PAGE < total} disabled={loading}
        onPrev={() => setOffset(value => Math.max(0, value - PAGE))} onNext={() => setOffset(value => value + PAGE)} />
    </Sheet>
  );
}
