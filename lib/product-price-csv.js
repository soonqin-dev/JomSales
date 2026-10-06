import { moneyToCents, MAX_UNIT_PRICE } from "../app/quotation-utils";
import { guessMapping } from "./product-csv";

export const PRICE_FIELDS = [["serial","调价产品编号 / SKU"],["price","调价新单价"]];
export function guessPriceMapping(headers) {
  const base=guessMapping(headers),normalized=headers.map(h=>h.toLowerCase().replace(/[\s_-]/g,""));
  const explicit=normalized.map((h,i)=>["newprice","newunitprice","新价格","新单价"].includes(h)?i:-1).filter(i=>i>=0);
  return {serial:base.serial,price:explicit.length===1?explicit[0]:explicit.length>1?-1:base.price};
}
export function previewPriceCsv(parsed,mapping) {
  if(!parsed?.rows?.length)throw new Error("请先选择 CSV 文件。");
  for(const key of ["serial","price"])if(!Number.isInteger(mapping[key])||mapping[key]<0||mapping[key]>=parsed.headers.length)throw new Error("必须对应产品编号和新单价两列。");
  if(mapping.serial===mapping.price)throw new Error("编号和价格不能使用同一列。");
  const counts=new Map();
  for(const values of parsed.rows){const code=values[mapping.serial].trim().toLowerCase();counts.set(code,(counts.get(code)||0)+1);}
  return parsed.rows.map((values,i)=>{
    const serial=values[mapping.serial].trim(),raw=values[mapping.price].trim(),cents=moneyToCents(raw);
    let error="";
    if(!serial||serial.length>120)error="产品编号需为 1–120 字符。";
    else if(counts.get(serial.toLowerCase())>1)error="CSV 内编号重复，该编号的全部行都跳过（不区分大小写）。";
    else if(cents===null||cents/100>MAX_UNIT_PRICE)error="新价格须为非负金额，最多两位小数，不超过 RM 9,999,999.99；空白不当作零。";
    return {row_number:i+1,csv_line:parsed.lineNumbers?.[i]||i+2,serial,raw_price:raw,new_price:cents===null?raw:(cents/100).toFixed(2),error,status:error?"invalid":"pending",product:null,old_price:null};
  });
}
export function matchPricePreview(rows,products) {
  const byCode=new Map(products.map(p=>[p.serial.trim().toLowerCase(),p]));
  return rows.map(row=>{
    if(row.error)return row;
    const product=byCode.get(row.serial.toLowerCase());
    if(!product)return {...row,status:"missing",error:"本公司没有此编号的有效产品，不会自动新增。"};
    return {...row,product,old_price:product.price,status:moneyToCents(product.price)===moneyToCents(row.new_price)?"unchanged":"ready"};
  });
}
export function priceUpdateEntry(row) {
  if(row.status!=="ready"||!row.product)throw new Error("此行不能调价，请重新预览。");
  return {row_number:row.row_number,csv_line:row.csv_line,product_id:row.product.id,serial:row.serial,
    expected_revision:row.product.revision,old_price:row.old_price,new_price:row.new_price};
}
export const PRICE_STATUS = {pending:"尚未检查",ready:"待确认调价",invalid:"格式错误／重复编号",missing:"编号不存在",unchanged:"价格相同，未修改",updated:"已调价",conflict:"发生冲突，未覆盖",unavailable:"产品不可用，未覆盖",failed:"失败，未确认",unprocessed:"未处理"};
export function priceReportCsv(preview,results={}) {
  const cell=value=>{let text=String(value??"");if(/^\s*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  const rows=[["CSV行号","产品编号","名称","原价","新价","结果","说明"],...preview.map(row=>{
    const outcome=results[row.row_number],status=outcome?.status||row.status;
    return [row.csv_line,row.serial,row.product?.name||"",outcome?.old_price??row.old_price??"",outcome?.new_price??row.new_price,PRICE_STATUS[status]||status,row.error||outcome?.message||""];
  })];
  return "\uFEFF"+rows.map(row=>row.map(cell).join(",")).join("\r\n");
}
