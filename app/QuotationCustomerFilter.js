"use client";
// G.CUSTOMER_FILTER — customer names that appear on visible quotations.
import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { InlineError, Pager, SearchBox, SkeletonList } from "./ui";
import Icon from "./icons";

export default function QuotationCustomerFilter({ companyId, creator = null, value, onChange, disabled }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [offset, setOffset] = useState(0);
  const [rows, setRows] = useState([]), [more, setMore] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  useEffect(() => { setOpen(false); setOffset(0); setRows([]); setQuery(""); }, [creator, companyId]);
  useEffect(() => {
    if (!open) return;
    const version = ++sequence.current;
    setRows([]); setLoading(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const result = await createClient().rpc("quotation_customer_options", { target_company: companyId, filter_creator: creator, option_search: query, page_offset: offset });
        if (result.error) throw result.error;
        if (version === sequence.current) { setRows(result.data.items); setMore(result.data.has_more); }
      } catch (err) { if (version === sequence.current) setError(err.message); }
      finally { if (version === sequence.current) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); ++sequence.current; };
  }, [open, query, offset, creator, companyId, retry]);

  return (
    <div className="field"><span className="field-label">顾客</span>
      <button type="button" className="input row-between" style={{ textAlign: "left" }} disabled={disabled} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <span className="ellipsis">{value !== null ? (value || "未填写客户") : "全部顾客"}</span><Icon name="chevronDown" size={18} />
      </button>
      {open && <div className="card stack-sm">
        <SearchBox value={query} onChange={text => { setQuery(text); setOffset(0); }} placeholder="查找报价顾客" />
        {error && <InlineError onRetry={() => setRetry(n => n + 1)}>{error}</InlineError>}
        {loading ? <SkeletonList count={3} height={40} /> : <div className="list-card">
          <button type="button" className="list-row" style={{ minHeight: 44 }} onClick={() => { onChange(null); setOpen(false); }}>
            <span className="list-text">全部顾客</span>{value === null && <Icon name="check" size={18} />}</button>
          {rows.map(name => <button type="button" key={name} className="list-row" style={{ minHeight: 44 }} onClick={() => { onChange(name); setOpen(false); }}>
            <span className="list-text">{name || "未填写客户"}</span>{value === name && <Icon name="check" size={18} />}</button>)}
          {!rows.length && !error && <p className="small muted" style={{ padding: 12 }}>没有符合的顾客</p>}
        </div>}
        <Pager page={Math.floor(offset / 30)} hasMore={more} disabled={loading} onPrev={() => setOffset(n => Math.max(0, n - 30))} onNext={() => setOffset(n => n + 30)} />
      </div>}
    </div>
  );
}
