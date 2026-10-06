export function dateDay(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const time=Date.parse(value+'T00:00:00.000Z');if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)return null;return time/86400000;
}
export function quotationDateRange(from,to){const start=dateDay(from),finish=dateDay(to);if(start===null||finish===null)throw new Error('请选择完整有效的报价日期。');if(finish<start)throw new Error('结束日期不能早于开始日期。');if(finish-start>29)throw new Error('查询区间含首尾最多 30 天，请缩小日期范围。');return{dateFrom:from,dateTo:to};}
export function recentQuotationRange(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=k=>parts.find(p=>p.type===k).value;
  const to=`${get('year')}-${get('month')}-${get('day')}`,from=new Date((dateDay(to)-29)*86400000).toISOString().slice(0,10);return quotationDateRange(from,to);
}
