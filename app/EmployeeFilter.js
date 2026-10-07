"use client";
// G.EMPLOYEE_FILTER — company roster, admins only (the RPC rejects others).
import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";

export default function EmployeeFilter({ companyId, value, onChange, disabled, label = "员工" }) {
  const [rows, setRows] = useState([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const version = ++sequence.current;
    setRows([]); setLoading(true); setError("");
    createClient().rpc("get_company_roster", { target_company: companyId }).then(result => {
      if (version !== sequence.current) return;
      if (result.error) setError(result.error.message); else setRows(result.data || []);
      setLoading(false);
    }).catch(err => { if (version === sequence.current) { setError(err.message); setLoading(false); } });
    return () => { ++sequence.current; };
  }, [companyId, retry]);
  return (
    <label className="field"><span className="field-label">{label}</span>
      <select className="input" aria-label={label} value={value || ""} disabled={disabled || loading || !!error} onChange={e => onChange(e.target.value || null)}>
        <option value="">全部员工（含管理员）</option>
        {rows.map(r => <option value={r.user_id} key={r.user_id}>{r.display_name || r.email}{r.display_name && ` · ${r.email}`}{r.removed_at ? "（已移除）" : !r.active ? "（已停用）" : ""}</option>)}
        {value && !rows.some(r => r.user_id === value) && <option value={value}>已选的历史员工</option>}
      </select>
      {error && <span className="field-error">员工名单读取失败：{error} <button type="button" className="text-btn danger" onClick={() => setRetry(n => n + 1)}>重试</button></span>}
    </label>
  );
}
