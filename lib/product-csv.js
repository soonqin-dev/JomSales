import { productFields } from "./supabase/products";

export const CSV_FIELDS = [
  ["serial", "产品编号 / SKU"], ["name", "名称"], ["price", "单价"], ["unit", "单位"],
  ["category", "分类"], ["description", "说明"], ["tags", "标签（| 分隔）"], ["is_service", "商品 / 服务"]
];
const aliases = {
  serial: ["serial","sku","code","productcode","产品编号","编号"], name: ["name","productname","名称","产品名称"],
  price: ["price","unitprice","单价","价格"], unit: ["unit","单位"], category: ["category","分类"],
  description: ["description","notes","说明","描述"], tags: ["tags","标签"], is_service: ["type","isservice","类型","项目类型"]
};

export function parseCsv(input, delimiter = ",") {
  if (typeof input !== "string" || input.length > 5 * 1024 * 1024) throw new Error("CSV 不能超过 5MB。");
  if (![",",";","\t"].includes(delimiter)) throw new Error("无效的分隔符。");
  const text = input.replace(/^\uFEFF/, ""), rows = [], lineNumbers = [];
  let row = [], field = "", quoted = false, closed = false, physicalLine = 1, rowStart = 1;
  function finishField() { row.push(field); field = ""; closed = false; if (row.length > 40) throw new Error("CSV 最多 40 列。"); }
  function finishRow() { finishField(); if (row.some(value => value.trim())) { rows.push(row); lineNumbers.push(rowStart); } row = []; if (rows.length > 10001) throw new Error("一次最多导入 10,000 行产品。"); }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else { field += ch; if (ch === "\n" || (ch === "\r" && text[i+1] !== "\n")) physicalLine++; }
    } else if (ch === delimiter) finishField();
    else if (ch === "\r" || ch === "\n") { if (ch === "\r" && text[i+1] === "\n") i++; finishRow(); physicalLine++; rowStart = physicalLine; }
    else if (ch === '"') { if (field || closed) throw new Error("CSV 引号格式错误，请重新导出。"); quoted = true; }
    else { if (closed && ch.trim()) throw new Error("CSV 引号结束后有多余文字。"); if (!closed) field += ch; }
    if (field.length > 10000) throw new Error("CSV 单个字段过长。");
  }
  if (quoted) throw new Error("CSV 引号未闭合。");
  if (field || row.length) finishRow();
  if (rows.length < 2) throw new Error("CSV 需包含标题行和至少一行产品。");
  const headers = rows.shift().map(value => value.trim());
  if (headers.some(value => !value) || new Set(headers.map(value => value.toLowerCase())).size !== headers.length) throw new Error("CSV 标题不能为空或重复。");
  if (rows.some(values => values.length !== headers.length)) throw new Error("CSV 行列数不一致，请检查分隔符和带逗号内容的引号。");
  return { headers, rows, lineNumbers: lineNumbers.slice(1) };
}

export function guessMapping(headers) {
  const normalized = headers.map(value => value.toLowerCase().replace(/[\s_-]/g, ""));
  return Object.fromEntries(CSV_FIELDS.map(([field]) => [field, normalized.findIndex(header => aliases[field].includes(header))]));
}

export function previewCsv(parsed, mapping) {
  for (const key of ["serial","name","price"]) if (!Number.isInteger(mapping[key]) || mapping[key] < 0 || mapping[key] >= parsed.headers.length) throw new Error("必须对应产品编号、名称和单价三列。");
  const selected = Object.values(mapping).filter(index => index >= 0);
  if (new Set(selected).size !== selected.length) throw new Error("同一 CSV 列不能对应多个字段。");
  const codes = new Set();
  return parsed.rows.map((values,index) => {
    const get = key => mapping[key] >= 0 ? values[mapping[key]] : "";
    try {
      const type = get("is_service").trim().toLowerCase();
      if (!["","product","商品","false","0","service","服务","人工","true","1"].includes(type)) throw new Error("项目类型需为 product／service 或 商品／服务。");
      const fields = productFields({ serial: get("serial"), name: get("name"), price: get("price").trim(), unit: get("unit").trim() || "件",
        category: get("category"), description: get("description"), tags: get("tags").split("|").map(value => value.trim()).filter(Boolean),
        is_service: ["service","服务","人工","true","1"].includes(type) });
      const code = fields.serial.toLowerCase();
      if (codes.has(code)) throw new Error("CSV 内产品编号重复（不区分大小写）。");
      codes.add(code);
      return { row_number: index+1, csv_line: parsed.lineNumbers?.[index] || index+2, fields, error: "" };
    } catch (err) { return { row_number: index+1, csv_line: parsed.lineNumbers?.[index] || index+2, raw_serial: get("serial"), raw_name: get("name"), error: err.message }; }
  });
}

export function csvTemplate() {
  return '\uFEFFSKU,Name,Price,Unit,Category,Description,Tags,Type\r\nHW-00001,电线,3.50,米,五金,规格示例,电工|材料,product\r\nSV-00001,安装人工,80.00,小时,服务,不含材料,,service\r\n';
}
