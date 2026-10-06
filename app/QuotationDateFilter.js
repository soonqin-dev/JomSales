"use client";
import {useState} from 'react';
import {quotationDateRange} from '../lib/quotation-filters';
export default function QuotationDateFilter({range,onApply,disabled}){
  const [mode,setMode]=useState('range'),[from,setFrom]=useState(range.dateFrom),[to,setTo]=useState(range.dateTo),[error,setError]=useState('');
  const unapplied=from!==range.dateFrom||(mode==='single'?from:to)!==range.dateTo;
  return <div className="accountCard"><form onSubmit={e=>{e.preventDefault();try{const next=quotationDateRange(from,mode==='single'?from:to);setError('');onApply(next);}catch(err){setError(err.message);}}}><fieldset disabled={disabled}>
    <label>日期方式<select aria-label="日期方式" value={mode} onChange={e=>{setMode(e.target.value);setError('');}}><option value="range">日期区间</option><option value="single">单日</option></select></label>
    <label>{mode==='single'?'报价日期':'报价开始日期'}<input aria-label={mode==='single'?'报价日期':'报价开始日期'} type="date" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
    {mode==='range'&&<label>报价结束日期<input aria-label="报价结束日期" type="date" required value={to} onChange={e=>setTo(e.target.value)}/></label>}
    <button>查询日期</button><p>按报价单日期，含首尾最多 30 天，可查询历史日期。</p>
  </fieldset></form>{error&&<p role="alert">{error}</p>}{unapplied&&<p>日期修改尚未应用，请点击「查询日期」。</p>}<p>当前查询：{range.dateFrom} 至 {range.dateTo}</p></div>;
}
