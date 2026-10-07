"use client";
// Quotation date filter: single day or a range of at most 30 days (inclusive).
import { useState } from "react";
import { quotationDateRange } from "../lib/quotation-filters";

export default function QuotationDateFilter({ range, onApply, disabled }) {
  const [mode, setMode] = useState(range.dateFrom === range.dateTo ? "single" : "range");
  const [from, setFrom] = useState(range.dateFrom), [to, setTo] = useState(range.dateTo), [error, setError] = useState("");
  const unapplied = from !== range.dateFrom || (mode === "single" ? from : to) !== range.dateTo;
  function apply(event) {
    event.preventDefault();
    try { const next = quotationDateRange(from, mode === "single" ? from : to); setError(""); onApply(next); }
    catch (err) { setError(err.message); }
  }
  return (
    <form className="stack-sm" onSubmit={apply}>
      <span className="field-label">日期</span>
      <div className="segmented" role="group" aria-label="日期方式">
        <button type="button" aria-pressed={mode === "range"} onClick={() => { setMode("range"); setError(""); }}>日期区间</button>
        <button type="button" aria-pressed={mode === "single"} onClick={() => { setMode("single"); setError(""); }}>单日</button>
      </div>
      <div className={mode === "range" ? "fields-2" : ""}>
        <input className="input" type="date" aria-label={mode === "single" ? "报价日期" : "报价开始日期"} required value={from} disabled={disabled} onChange={e => setFrom(e.target.value)} />
        {mode === "range" && <input className="input" type="date" aria-label="报价结束日期" required value={to} disabled={disabled} onChange={e => setTo(e.target.value)} />}
      </div>
      <button type="submit" className="btn btn-primary btn-sm" disabled={disabled}>查询</button>
      {error && <span className="field-error" role="alert">{error}</span>}
      {unapplied && !error && <span className="field-hint">日期已修改，点「查询」后生效。</span>}
      <span className="field-hint">按报价日期，含首尾最多 30 天。</span>
    </form>
  );
}
