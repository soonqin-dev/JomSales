export const PASSWORD_MIN_LENGTH=6;
export const PASSWORD_MAX_LENGTH=128;
export function profileFields(name, phone) {
  const displayName = String(name || "").trim();
  const whatsapp = String(phone || "").replace(/[\s()-]/g, "");
  if (!displayName || displayName.length > 120) throw new Error("姓名需为 1–120 个字符。");
  if (whatsapp && !/^\+[1-9]\d{7,14}$/.test(whatsapp)) throw new Error("WhatsApp 号码需包含国家区号，例如 +60123456789。");
  return { displayName, whatsapp };
}

// Fixed +60 entry (auth-spec §5.2): "012 345 6789", "12 345 6789", "+60 12…" and "6012…"
// all become "+60123456789". Never produces "+6060…" or "+600…".
export function normalizeMalaysiaPhone(value) {
  let digits = String(value || "").replace(/[\s()-]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+60")) digits = digits.slice(3);
  else if (digits.startsWith("60")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  const phone = `+60${digits}`;
  if (!/^\d+$/.test(digits) || !/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new Error("请输入正确的手机号码，例如 12 345 6789。");
  return phone;
}

// Local part shown after the fixed +60 prefix; null when the stored number is not Malaysian.
export function malaysiaLocalPart(phone) {
  if (!phone) return "";
  return phone.startsWith("+60") ? phone.slice(3) : null;
}

export function validatePassword(password, confirmation) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) throw new Error(`密码需为 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符。`);
  if (password !== confirmation) throw new Error("两次输入的密码不一致。");
  return password;
}

export function memberLabel(member) {
  return member?.role === "admin" ? member.is_primary ? "正管理员" : "副管理员" : "销售员";
}

export function nullableLimit(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("额度必须是正整数，留空表示暂不限制。");
  return number;
}

export function completeCompanyProfile(profile) {
  return typeof profile?.display_name==='string'&&profile.display_name.trim().length>0&&/^\+[1-9][0-9]{7,14}$/.test(profile.whatsapp || '');
}
const companyRoutes=new Set(['/cloud','/customers','/quotations','/team','/brand','/catalog-settings','/catalog-share']);
const companyUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function companyReturn(value,companyId='') {
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//'))return companyId&&companyUuid.test(companyId)?`/cloud?company=${companyId}`:'';
  try {
    const url=new URL(value,'https://jomsales.invalid');if(url.origin!=='https://jomsales.invalid'||!companyRoutes.has(url.pathname)||url.hash)return companyId&&companyUuid.test(companyId)?`/cloud?company=${companyId}`:'';
    const id=companyId || url.searchParams.get('company');if(!companyUuid.test(id || ''))return '';
    const query=new URLSearchParams({company:id});if(url.pathname==='/cloud')for(const key of ['quote','duplicate']){const v=url.searchParams.get(key);if(v&&companyUuid.test(v))query.set(key,v);}
    return `${url.pathname}?${query}`;
  }catch{return '';}
}
