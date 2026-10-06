"use client";
import { useState } from "react";
export default function TemporaryItem({quotation,disabled}) {
  const initial={name:"",price:"",quantity:"1",unit:"次",description:"",service:true};
  const draft=quotation.temporaryDraft || initial;
  const setDraft=value=>quotation.setTemporaryDraft(value);
  const [error,setError]=useState("");
  return <details className="quotationSection"><summary>添加临时商品／人工（不进入目录）</summary>
    <form onSubmit={e=>{e.preventDefault();try{quotation.addTemporary(draft);setError("");}catch(err){setError(err.message);}}}><fieldset disabled={disabled}>
      <label>临时项目名称<input required maxLength={240} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <label>临时项目单价（RM）<input required inputMode="decimal" value={draft.price} onChange={e=>setDraft({...draft,price:e.target.value})}/></label>
      <label>临时项目数量<input required inputMode="decimal" value={draft.quantity} onChange={e=>setDraft({...draft,quantity:e.target.value})}/></label>
      <label>临时项目单位<input required maxLength={30} value={draft.unit} onChange={e=>setDraft({...draft,unit:e.target.value})}/></label>
      <label>临时项目类型<select value={draft.service?'service':'product'} onChange={e=>setDraft({...draft,service:e.target.value==='service'})}><option value="service">服务／人工</option><option value="product">商品／材料</option></select></label>
      <label>临时项目说明<textarea aria-label="临时项目说明" rows={2} maxLength={2000} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
      {error&&<p role="alert">{error}</p>}<button type="submit">加入本张报价</button><button type="button" onClick={()=>setDraft(null)}>清空临时输入</button>
    </fieldset></form>
  </details>;
}
