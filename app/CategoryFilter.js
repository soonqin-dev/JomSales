"use client";
export default function CategoryFilter({categories=[],value=null,onChange,disabled=false,label='按分类筛选'}){
  const options=categories.map(c=>typeof c==='string'?{name:c,active:true}:c).filter(c=>c.name!==''&&(c.active||Number(c.product_count)>0));
  return <label className="categoryFilter">{label}<select aria-label={label} disabled={disabled} value={JSON.stringify(value)} onChange={e=>onChange(JSON.parse(e.target.value))}>
    <option value="null">全部分类</option><option value={'""'}>未分类</option>{options.map(c=><option key={c.name} value={JSON.stringify(c.name)}>{c.name}{!c.active&&'（已停用）'}</option>)}
    {value&& !options.some(c=>c.name===value)&&<option value={JSON.stringify(value)}>当前分类：{value}（已变更或无可见产品）</option>}
  </select></label>;
}
