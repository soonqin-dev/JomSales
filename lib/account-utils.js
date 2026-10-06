export function profileFields(name, phone) {
  const displayName = String(name || "").trim();
  const whatsapp = String(phone || "").replace(/[\s()-]/g, "");
  if (!displayName || displayName.length > 120) throw new Error("姓名需为 1–120 个字符。");
  if (whatsapp && !/^\+[1-9]\d{7,14}$/.test(whatsapp)) throw new Error("WhatsApp 号码需包含国家区号，例如 +60123456789。");
  return { displayName, whatsapp };
}

export function validatePassword(password, confirmation) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) throw new Error("密码需为 12–128 个字符。");
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
