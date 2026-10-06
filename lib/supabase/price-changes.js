import {priceUpdateEntry} from '../product-price-csv';
export const PRICE_APPLY_TERMINAL=new Set(['updated','unchanged','conflict','unavailable','failed']);
export async function readPriceSnapshots(client,companyId,codes,{stopped=()=>false}={}){
  const products=[],unique=[...new Set(codes.map(c=>c.trim().toLowerCase()))];
  for(let offset=0;offset<unique.length;offset+=500){if(stopped())throw new Error('读取已停止，当前内容仍保留。');const r=await client.rpc('preview_product_prices',{target_company:companyId,codes:unique.slice(offset,offset+500)});if(r.error)throw r.error;if(!Array.isArray(r.data))throw new Error('原价结果无效，请重试。');products.push(...r.data);}return products;
}
export async function applyPriceBatches(client,companyId,jobId,rows,{results,stopped=()=>false,onProgress=()=>{}}){
  for(let offset=0;offset<rows.length&&!stopped();offset+=100){const batch=rows.slice(offset,offset+100),r=await client.rpc('apply_product_prices',{target_company:companyId,request_job:jobId,entries:batch.map(priceUpdateEntry)});if(r.error)throw r.error;
    const outcomes=r.data,wanted=new Set(batch.map(row=>row.row_number));if(!Array.isArray(outcomes)||outcomes.length!==batch.length||new Set(outcomes.map(row=>row.row_number)).size!==batch.length||outcomes.some(row=>!wanted.has(row.row_number)||!PRICE_APPLY_TERMINAL.has(row.status)))throw new Error('结果未确认，请保留本页并重试；不会重复修改已确认行。');
    for(const row of outcomes)results[row.row_number]=row;onProgress({...results});
  }
}
