const COLUMNS = "id,company_id,created_by,name,company,phone,email,address,active,revision,created_at";
const fail = error => { if (error) throw new Error(error.message || "客户资料操作失败。"); };
export function customerFields(value) {
  const fields = Object.fromEntries(["name","company","phone","email","address"].map(key => [key,String(value[key] || "").trim()]));
  if (!fields.name || fields.name.length>120 || fields.company.length>120 || fields.phone.length>40 || fields.email.length>254 || fields.address.length>1000 ||
    (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))) throw new Error("客户姓名、邮箱或联系方式无效。");
  return fields;
}
export async function listCustomers(client,companyId,query="",inactive=false,offset=0,owner=null) {
  const result=await client.rpc("search_company_customers",{target_company:companyId,search_text:query,include_inactive:inactive,page_offset:offset,filter_owner:owner});
  fail(result.error);return result.data;
}
export async function saveCustomer(client,context,draft,previous=null) {
  const fields=customerFields(draft),id=previous?.id || draft.id;
  if (!id || (previous && previous.created_by!==context.userId)) throw new Error("只能维护自己建立的客户。");
  try {
    const query=previous ? client.from("customers").update(fields).eq("company_id",context.companyId).eq("id",id).eq("revision",previous.revision)
      : client.from("customers").insert({...fields,id,company_id:context.companyId});
    const result=await query.select(COLUMNS).maybeSingle();fail(result.error);
    if(!result.data)throw new Error("客户已被修改或权限发生变化，请重新读取。");return result.data;
  } catch(err) {
    const confirmed=await client.from("customers").select(COLUMNS).eq("company_id",context.companyId).eq("id",id).maybeSingle();
    if(!confirmed.error && confirmed.data?.created_by===context.userId && Object.entries(fields).every(([key,value])=>confirmed.data[key]===value))return confirmed.data;
    throw err;
  }
}
export async function setCustomerActive(client,context,row,active) {
  if(row.created_by!==context.userId)throw new Error("只能维护自己建立的客户。");
  const result=await client.from("customers").update({active}).eq("company_id",context.companyId).eq("id",row.id).eq("revision",row.revision).select(COLUMNS).maybeSingle();
  fail(result.error);if(!result.data)throw new Error("客户已改变，请刷新后重试。");return result.data;
}
