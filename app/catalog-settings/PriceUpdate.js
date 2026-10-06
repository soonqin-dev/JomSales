"use client";
import { useEffect,useRef,useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { parseCsv } from "../../lib/product-csv";
import { previewPriceCsv,guessPriceMapping,matchPricePreview,priceUpdateEntry,priceReportCsv,PRICE_FIELDS,PRICE_STATUS } from "../../lib/product-price-csv";
import { downloadFile } from "../share";
import { formatMoney,moneyToCents } from "../quotation-utils";

const terminal=new Set(["updated","unchanged","conflict","unavailable","failed"]);
export default function PriceUpdate({context,blocked=false,onBusyChange}) {
  const [text,setText]=useState(""),[filename,setFilename]=useState(""),[delimiter,setDelimiter]=useState(","),[parsed,setParsed]=useState(null),[mapping,setMapping]=useState({});
  const [preview,setPreview]=useState(null),[results,setResults]=useState({}),[busy,setBusy]=useState(false),[applying,setApplying]=useState(false),[begun,setBegun]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const working=useRef(false),stop=useRef(false),alive=useRef(true),job=useRef(null),started=useRef(false),resultRef=useRef({});
  async function rpc(name,args){const result=await createClient().rpc(name,args);if(result.error)throw result.error;return result.data;}
  async function run(task){if(working.current||blocked)return;working.current=true;setBusy(true);onBusyChange?.(true);setError("");setMessage("");try{await task();}catch(err){if(alive.current)setError(err.message||"操作未确认，请保留本页并重试；当前预览仍保留。");}finally{working.current=false;if(alive.current){setBusy(false);onBusyChange?.(false);}}}
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;stop.current=true;};},[]);
  useEffect(()=>{const leave=e=>{if(busy||started.current){e.preventDefault();e.returnValue="";}};const link=e=>{
    const a=e.target.closest?.("a[href]");if(!a||a.hasAttribute("download")||a.target==="_blank")return;
    if((busy||started.current)&&(busy||!window.confirm("离开将丢失本页调价进度；已修改的价格和记录保留，不会自动回滚。继续？"))){e.preventDefault();e.stopPropagation();}
  };window.addEventListener("beforeunload",leave);document.addEventListener("click",link,true);return()=>{window.removeEventListener("beforeunload",leave);document.removeEventListener("click",link,true);};},[busy]);
  function reset(){if(working.current||blocked||(started.current&&!window.confirm("重新预览会开始新任务，已修改的价格不会自动恢复。继续？")))return false;
    setPreview(null);setResults({});resultRef.current={};job.current=null;started.current=false;setBegun(false);return true;}
  function parse(content,separator){const p=parseCsv(content,separator);setParsed(p);setMapping(guessPriceMapping(p.headers));}
  async function choose(file){if(!file||!reset())return;await run(async()=>{
    if(!/\.csv$/i.test(file.name)||file.size>5*1024*1024)throw new Error("请选择不超过 5MB 的 CSV UTF-8 文件。");
    const content=await file.text();if(!alive.current)return;if(content.includes("\uFFFD"))throw new Error("文件不是有效 UTF-8，请重新从 Excel 另存为 CSV UTF-8。");
    setText(content);setFilename(file.name);setParsed(null);parse(content,delimiter);
  });}
  async function inspect(){await run(async()=>{
    setPreview(null);job.current=null;const rows=previewPriceCsv(parsed,mapping),codes=rows.filter(r=>!r.error).map(r=>r.serial),products=[];
    for(let offset=0;offset<codes.length&&!stop.current;offset+=500){const found=await rpc("preview_product_prices",{target_company:context.companyId,codes:codes.slice(offset,offset+500)});if(!Array.isArray(found))throw new Error("预览结果无效，请重试。");products.push(...found);}
    if(!alive.current)return;setPreview(matchPricePreview(rows,products));job.current=crypto.randomUUID();setMessage("预览完成，尚未修改价格。仅按编号匹配本公司产品；名称、照片、单位等其他字段不会改动。");
  });}
  async function apply(){if(working.current||blocked||!preview||!job.current)return;
    const pending=preview.filter(r=>r.status==="ready"&&!terminal.has(resultRef.current[r.row_number]?.status));
    if(!pending.length||!window.confirm(`确认尝试修改 ${pending.length} 项产品价格？只修改价格，不改名称、照片或已保存报价；预览后被修改的产品会跳过。`))return;
    started.current=true;setBegun(true);stop.current=false;setApplying(true);
    await run(async()=>{try{
      for(let offset=0;offset<pending.length&&!stop.current;offset+=100){const batch=pending.slice(offset,offset+100),outcomes=await rpc("apply_product_prices",{target_company:context.companyId,request_job:job.current,entries:batch.map(priceUpdateEntry)});
        const wanted=new Set(batch.map(r=>r.row_number));if(!Array.isArray(outcomes)||outcomes.length!==batch.length||new Set(outcomes.map(r=>r.row_number)).size!==batch.length||outcomes.some(r=>!wanted.has(r.row_number)||!terminal.has(r.status)))throw new Error("结果未确认，请保留本页并重试；不会重复修改已确认行。");
        for(const row of outcomes)resultRef.current[row.row_number]=row;if(alive.current)setResults({...resultRef.current});
      }
      if(alive.current)setMessage(stop.current?"调价已暂停。已修改的价格保留，可继续处理。":"本次调价处理完成。冲突／无效行需重新预览；已修改的价格和操作记录保留。");
    }finally{if(alive.current)setApplying(false);}});
  }
  const locked=busy||blocked,ready=preview?.filter(r=>r.status==="ready").length||0;
  const remaining=preview?.filter(r=>r.status==="ready"&&!terminal.has(results[r.row_number]?.status)).length||0;
  const errors=preview?.filter(r=>r.status==="invalid").length||0,missing=preview?.filter(r=>r.status==="missing").length||0,unchanged=preview?.filter(r=>r.status==="unchanged").length||0;
  const updated=Object.values(results).filter(r=>r.status==="updated").length,conflicts=Object.values(results).filter(r=>["conflict","unavailable","failed"].includes(r.status)).length;
  const amount=value=>value==null?"—":formatMoney(moneyToCents(value));
  return <details className="accountCard"><summary>CSV 批量调价（管理员）</summary>
    <p>只修改现有产品价格，不自动新增。编号不区分大小写，保留前导零；空白价格不当作零。最多 10,000 行、5MB，先预览再确认。</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <button disabled={locked} onClick={()=>downloadFile(new File(["\uFEFFSKU,Price\r\nYOUR-SKU,12.50\r\n"],"jomsales-price-template.csv",{type:"text/csv;charset=utf-8"}))}>下载调价 CSV 模板</button>
    <label>选择调价 CSV 文件<input type="file" accept=".csv,text/csv" disabled={locked} onChange={e=>{const file=e.target.files?.[0];e.target.value="";void choose(file);}}/></label>
    {text&&<><p>{filename}</p><label>调价分隔符<select aria-label="调价分隔符" value={delimiter} disabled={locked||begun} onChange={e=>{setDelimiter(e.target.value);setPreview(null);job.current=null;setParsed(null);try{parse(text,e.target.value);setError("");}catch(err){setError(err.message);}}}><option value=",">逗号</option><option value=";">分号</option><option value={"\t"}>Tab</option></select></label></>}
    {parsed&&<><fieldset disabled={locked||begun}>{PRICE_FIELDS.map(([key,label])=><label key={key}>{label}<select aria-label={label} value={mapping[key]??-1} onChange={e=>{setMapping({...mapping,[key]:Number(e.target.value)});setPreview(null);job.current=null;}}><option value={-1}>请选择对应列</option>{parsed.headers.map((header,i)=><option value={i} key={i}>{header}</option>)}</select></label>)}</fieldset><button disabled={locked||begun} onClick={()=>{stop.current=false;void inspect();}}>预览新旧价格</button></>}
    {preview&&<><p>共 {preview.length} 行 · 可调价 {ready} · 价格相同 {unchanged} · 编号不存在 {missing} · 格式错误／重复 {errors}</p>
      <p role="status">已确认调价 {updated} · 冲突／失败 {conflicts} · 尚未确认 {remaining}</p>
      <div className="cloudButtons"><button disabled={locked||!remaining} onClick={()=>void apply()}>{begun?"继续／重试未确认调价":"确认批量调价"}</button>{applying&&<button onClick={()=>{stop.current=true;}}>当前批次完成后暂停调价</button>}
        <button disabled={locked} onClick={()=>downloadFile(new File([priceReportCsv(preview,results)],"jomsales-price-results.csv",{type:"text/csv;charset=utf-8"}))}>下载完整调价检查／结果</button>
        <button disabled={locked} onClick={()=>{if(reset()){stop.current=false;setMessage("可以重新选择列，再预览最新价格。");}}}>重新预览调价</button></div>
      <h3>新旧价格预览（最多显示 20 行）</h3>{preview.slice(0,20).map(row=><div className="teamRow" key={row.row_number}><div><strong>CSV 第 {row.csv_line} 行 · {row.serial || "编号无效"}</strong><p>{row.product?.name||""}</p><p>原价 {amount(row.old_price)} → 新价 {amount(row.new_price)}</p><p>{row.error||results[row.row_number]?.message||PRICE_STATUS[results[row.row_number]?.status||row.status]}</p></div></div>)}
    </>}
  </details>;
}
