"use client";
import { useEffect,useRef,useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { readQuotationDefaults } from "../../lib/supabase/workspace";
export default function QuoteDefaults({context}) {
  const [previous,setPrevious]=useState(null),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const working=useRef(false),sequence=useRef(0);
  async function load(){if(working.current||(dirty&&!window.confirm("放弃未保存的报价默认设置？")))return;working.current=true;setBusy(true);const version=++sequence.current;
    try{const row=await readQuotationDefaults(createClient(),context.companyId);if(version===sequence.current){setPrevious(row);setDraft(row);setDirty(false);setError("");}}
    catch(err){if(version===sequence.current)setError(err.message);}finally{working.current=false;setBusy(false);}}
  useEffect(()=>{void load();return()=>{++sequence.current;};},[]);
  useEffect(()=>{const leave=e=>{if(dirty||busy){e.preventDefault();e.returnValue="";}};const link=e=>{if((dirty||busy)&&e.target.closest?.("a[href]")&&(busy||!window.confirm("报价默认设置未保存，确认离开？"))){e.preventDefault();e.stopPropagation();}};window.addEventListener("beforeunload",leave);document.addEventListener("click",link,true);return()=>{window.removeEventListener("beforeunload",leave);document.removeEventListener("click",link,true);};},[dirty,busy]);
  const edit=(key,value)=>{setDraft({...draft,[key]:value});setDirty(true);};
  return <details className="accountCard"><summary>新报价默认设置</summary>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {draft&&<form onSubmit={async e=>{e.preventDefault();if(working.current)return;working.current=true;setBusy(true);setError("");try{
      const result=await createClient().rpc("save_quotation_defaults",{target_company:context.companyId,expected_revision:previous.revision,number_prefix:draft.prefix,number_digits:Number(draft.digits),valid_days:Number(draft.validity_days),payment_text:draft.payment_terms,default_notes:draft.notes});
      if(result.error)throw result.error;const row=Array.isArray(result.data)?result.data[0]:result.data;setPrevious(row);setDraft(row);setDirty(false);setMessage("默认设置已保存，新报价生效，旧报价不会改变。");
    }catch(err){setError(err.message);}finally{working.current=false;setBusy(false);}}}><fieldset disabled={busy}>
      <label>报价编号前缀<input required maxLength={30} value={draft.prefix} onChange={e=>edit("prefix",e.target.value)}/></label>
      <label>报价流水号位数<input type="number" required min={1} max={12} value={draft.digits} onChange={e=>edit("digits",e.target.value)}/></label>
      <label>默认有效天数<input type="number" required min={1} max={365} value={draft.validity_days} onChange={e=>edit("validity_days",e.target.value)}/></label>
      <label>默认付款条款<textarea aria-label="默认付款条款" rows={3} maxLength={1500} value={draft.payment_terms} onChange={e=>edit("payment_terms",e.target.value)}/></label>
      <label>默认备注／T&amp;C<textarea aria-label="默认备注／T&C" rows={3} maxLength={3000} value={draft.notes} onChange={e=>edit("notes",e.target.value)}/></label>
      <p>币种 MYR。编号示例：{draft.prefix}-{new Date().getFullYear()}-{String(1).padStart(Math.max(1,Math.min(12,Number(draft.digits))),"0")}，保存时由云端分配。</p>
      <button>保存报价默认设置</button><button type="button" onClick={load}>重新读取默认设置</button>
    </fieldset></form>}
  </details>;
}
