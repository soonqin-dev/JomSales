"use client";
import { useEffect,useRef,useState } from 'react';
import { createClient } from '../../lib/supabase/client';
import { readCategories } from '../../lib/supabase/categories';
export default function Categories({context,blocked=false,onBusyChange}){
  const [rows,setRows]=useState([]),[name,setName]=useState(''),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const working=useRef(false),pending=useRef(null),alive=useRef(true),dirty=!!name.trim();
  async function load(){const data=await readCategories(createClient(),context.companyId);if(alive.current)setRows(data);}
  async function run(task){if(working.current||blocked)return;working.current=true;setBusy(true);onBusyChange?.(true);setError('');try{await task();}catch(err){if(alive.current)setError(err.code==='23505'?'此公司已有相同分类名称，请编辑或恢复原分类。':err.message);}finally{working.current=false;if(alive.current){setBusy(false);onBusyChange?.(false);}}}
  useEffect(()=>{alive.current=true;void run(load);return()=>{alive.current=false;};},[]);
  useEffect(()=>{const leave=e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}};const link=e=>{if((dirty||busy)&&e.target.closest?.('a[href]')&&(busy||!window.confirm('分类修改尚未保存，确认离开？'))){e.preventDefault();e.stopPropagation();}};window.addEventListener('beforeunload',leave);document.addEventListener('click',link,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('click',link,true);};},[dirty,busy]);
  async function act(row,action){if(!window.confirm(`${action==='archive'?'停用':'恢复'}分类 ${row.name}？停用不会删除产品或清空原分类，已有产品仍可筛选。`))return;await run(async()=>{const result=await createClient().rpc('manage_company_category',{target_company:context.companyId,target_category:row.id,category_name:row.name,expected_revision:row.revision,action});if(result.error)throw result.error;await load();setMessage('分类状态已更新。');});}
  return <details className="accountCard"><summary>公司分类管理（管理员）</summary>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <p>员工可使用公司已有分类；只有管理员能新增、改名、停用和恢复。分类改名会同步现有产品，不改变历史报价。</p>
    <form onSubmit={e=>{e.preventDefault();void run(async()=>{const normalized=name.trim();if(!normalized||normalized.length>80)throw new Error('分类名称需为 1–80 字符。');if(!editing&&pending.current?.name!==normalized)pending.current={id:crypto.randomUUID(),name:normalized};
      const result=await createClient().rpc('manage_company_category',{target_company:context.companyId,target_category:editing?.id||pending.current.id,category_name:normalized,expected_revision:editing?.revision||0,action:editing?'rename':'create'});if(result.error)throw result.error;setName('');setEditing(null);pending.current=null;await load();setMessage('分类已保存。');
    });}}><label>分类名称<input aria-label="分类名称" maxLength={80} required disabled={busy||blocked} value={name} onChange={e=>setName(e.target.value)}/></label><button disabled={busy||blocked}>{editing?'保存分类名称':'新增分类'}</button>
      {editing&&<button type="button" disabled={busy||blocked} onClick={()=>{if(!dirty||window.confirm('放弃分类修改？')){setEditing(null);setName('');}}}>取消分类编辑</button>}
    </form><button disabled={busy||blocked} onClick={()=>void run(load)}>刷新分类</button>
    {!rows.length&&<p>暂无分类，可先新增，或由管理员在 CSV 新增产品时导入分类。</p>}
    {rows.map(row=><article className="teamRow" key={row.id}><div><strong>{row.name}</strong><p>{row.active?'可分配':'已停用'} · {row.product_count} 项产品</p></div><div className="cloudButtons">
      {row.active&&<button disabled={busy||blocked} onClick={()=>{if(!dirty||window.confirm('放弃当前分类修改？')){setEditing(row);setName(row.name);}}}>编辑分类 · {row.name}</button>}
      <button disabled={busy||blocked} onClick={()=>void act(row,row.active?'archive':'restore')}>{row.active?'停用':'恢复'}分类 · {row.name}</button>
    </div></article>)}
  </details>;
}
