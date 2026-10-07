"use client";
// DEF｜报价默认设置 — only affects new quotations.
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { readQuotationDefaults } from "../../../lib/supabase/workspace";
import { useMember } from "../../member-context";
import { InlineError, MoreMenu, SkeletonList, useConfirm, useToast } from "../../ui";

export default function QuoteDefaults({ onDirty }) {
  const member = useMember(), confirm = useConfirm(), toast = useToast();
  const [previous, setPrevious] = useState(null), [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState("");
  const working = useRef(false), sequence = useRef(0);
  useEffect(() => { onDirty?.(dirty); }, [dirty]);

  async function load(ask = true) {
    if (working.current) return;
    if (ask && dirty && !(await confirm({ title: "重新读取？", message: "未保存的默认设置会被放弃。", confirmLabel: "重新读取", danger: true }))) return;
    working.current = true; setBusy(true); const version = ++sequence.current;
    try {
      const row = await readQuotationDefaults(createClient(), member.companyId);
      if (version === sequence.current) { setPrevious(row); setDraft(row); setDirty(false); setError(""); }
    } catch (err) { if (version === sequence.current) setError(err.message); }
    finally { working.current = false; setBusy(false); }
  }
  useEffect(() => { void load(false); return () => { ++sequence.current; }; }, []);
  useEffect(() => {
    const leave = e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, busy]);

  const edit = (key, value) => { setDraft(prev => ({ ...prev, [key]: value })); setDirty(true); };

  async function save(event) {
    event.preventDefault();
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      const result = await createClient().rpc("save_quotation_defaults", { target_company: member.companyId, expected_revision: previous.revision, number_prefix: draft.prefix,
        number_digits: Number(draft.digits), valid_days: Number(draft.validity_days), payment_text: draft.payment_terms, default_notes: draft.notes });
      if (result.error) throw result.error;
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      setPrevious(row); setDraft(row); setDirty(false);
      toast("默认设置已保存，只影响新报价");
    } catch (err) { setError(err.message); }
    finally { working.current = false; setBusy(false); }
  }

  if (!draft) return error ? <InlineError onRetry={() => void load(false)}>{error}</InlineError> : <SkeletonList count={4} height={56} />;
  const digits = Math.max(1, Math.min(12, Number(draft.digits) || 1));
  return (
    <form className="stack" onSubmit={save}>
      <div className="row-between"><div className="notice-box grow">只影响之后新建的报价，旧报价不会改变。</div>
        <MoreMenu items={[{ label: "重新读取", icon: "refresh", onSelect: () => void load() }]} /></div>
      <div className="fields-2">
        <label className="field"><span className="field-label">编号前缀</span>
          <input className="input" required maxLength={30} value={draft.prefix} disabled={busy} onChange={e => edit("prefix", e.target.value)} /></label>
        <label className="field"><span className="field-label">流水号位数</span>
          <input className="input" type="number" required min={1} max={12} value={draft.digits} disabled={busy} onChange={e => edit("digits", e.target.value)} /></label>
      </div>
      <p className="field-hint">编号示例：{draft.prefix}-{new Date().getFullYear()}-{"1".padStart(digits, "0")}（保存时由系统分配）</p>
      <label className="field"><span className="field-label">默认有效天数</span>
        <input className="input" type="number" required min={1} max={365} value={draft.validity_days} disabled={busy} onChange={e => edit("validity_days", e.target.value)} /></label>
      <label className="field"><span className="field-label">默认付款条款</span>
        <textarea className="input" rows={3} maxLength={1500} value={draft.payment_terms} disabled={busy} onChange={e => edit("payment_terms", e.target.value)} /></label>
      <label className="field"><span className="field-label">默认备注／条款</span>
        <textarea className="input" rows={4} maxLength={3000} value={draft.notes} disabled={busy} onChange={e => edit("notes", e.target.value)} /></label>
      <InlineError>{error}</InlineError>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !dirty}>{busy ? "保存中…" : "保存默认设置"}</button>
    </form>
  );
}
