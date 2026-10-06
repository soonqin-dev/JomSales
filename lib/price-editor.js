import {moneyToCents} from '../app/quotation-utils';
import {previewPriceCsv,matchPricePreview} from './product-price-csv';
export const MAX_PRICE_EDITOR_ROWS=10000;
export function priceEditorProduct(p){const cents=moneyToCents(p.price);if(!p.id||!p.serial||!p.name||!Number.isInteger(p.revision)||cents===null)throw new Error('产品资料无效，请刷新目录。');return{id:p.id,serial:p.serial,name:p.name,price:(cents/100).toFixed(2),revision:p.revision,unit:p.unit||'件',category:p.category||''};}
export function addPriceEditorProducts(drafts,products){
  const result=[...drafts],codes=new Set(drafts.map(d=>d.serial.trim().toLowerCase()));
  for(const row of products){const p=priceEditorProduct(row);if(codes.has(p.serial.toLowerCase()))continue;if(result.length>=MAX_PRICE_EDITOR_ROWS)throw new Error('本次最多选择 10,000 项产品。');result.push({key:crypto.randomUUID(),serial:p.serial,newPrice:p.price,product:p});codes.add(p.serial.toLowerCase());}return result;
}
export function validatePriceEditorRows(drafts){if(!drafts.length||drafts.length>MAX_PRICE_EDITOR_ROWS)throw new Error('请加入 1–10,000 项待调价产品。');return previewPriceCsv({headers:['SKU','Price'],rows:drafts.map(d=>[d.serial,d.newPrice]),lineNumbers:drafts.map((_,i)=>i+2)},{serial:0,price:1});}
export function preparePriceEditorRows(drafts,products){
  const rows=matchPricePreview(validatePriceEditorRows(drafts),products);
  return rows.map((r,i)=>{const base=drafts[i].product;if(!base||r.error)return r;
    if(r.product?.id!==base.id)return {...r,status:'unavailable',error:'原产品不可用或编号已被另一产品使用，请移除后重新选取。',product:base,old_price:base.price};
    if(r.product.revision!==base.revision||moneyToCents(r.product.price)!==moneyToCents(base.price))return {...r,status:'conflict',error:'原价或产品资料已变，请明确重读原价后再检查。',product:base,old_price:base.price};
    return {...r,product:base,old_price:base.price};
  });
}
export function refreshPriceEditorBases(drafts,products){const byCode=new Map(products.map(p=>[p.serial.trim().toLowerCase(),p]));return drafts.map(d=>{const p=byCode.get(d.serial.trim().toLowerCase());return p&&(!d.product||d.product.id===p.id)?{...d,product:priceEditorProduct(p)}:d;});}
export function exportPriceEditorCsv(drafts){
  const quote=s=>'"'+String(s??'').replaceAll('"','""')+'"';
  const safe=s=>/^\s*[=+@-]/.test(s)?"'"+s:s;
  // Explicit marker preserves leading zeros and formula-like SKUs on round-trip.
  const text='\uFEFFSKU,NewPrice,JomSalesSKUEncoding\r\n'+drafts.map(d=>["'"+d.serial,safe(d.newPrice),'apostrophe_v1'].map(quote).join(',')).join('\r\n');
  if(new TextEncoder().encode(text).length>5*1024*1024)throw new Error('导出超过 5MB，请减少待调价行数后分批导出。');return text;
}
