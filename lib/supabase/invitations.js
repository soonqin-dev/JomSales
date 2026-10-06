export const INVITE_KEY = "salesgo_pending_invite";
export const validInviteToken = token => typeof token === "string" && /^[0-9a-f]{64}$/.test(token);

export function newInviteToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

// The link fragment is not sent to the web server. Keep it only in this tab's
// session storage while the user visits account/verification screens.
export function pendingInvite() {
  const token = window.sessionStorage.getItem(INVITE_KEY);
  return validInviteToken(token) ? token : null;
}

export function captureInvite() {
  if (window.location.hash) {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (!validInviteToken(token)) {
      window.sessionStorage.removeItem(INVITE_KEY);
      throw new Error("邀请链接不完整，请重新打开管理员发给你的完整链接。");
    }
    window.sessionStorage.setItem(INVITE_KEY, token);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return token;
  }
  const token = pendingInvite();
  if (!token) throw new Error("没有待接受的邀请，请打开管理员发给你的完整邀请链接。");
  return token;
}

export function teamError(error) {
  const message = error?.message || "";
  if (/Administrator access required/i.test(message)) return "需要当前公司的有效管理员权限，请重新登录或联系公司管理员。";
  if (/already a member/i.test(message)) return "该邮箱已是公司成员，请在员工列表管理权限，不要重复邀请。";
  if (/verified invited email|another email|Invitation invalid/i.test(message)) return "邀请无效，或当前账号不是已验证的受邀邮箱；也可能已过期／撤销。请确认邮箱，必要时让管理员重新邀请。";
  if (/expired or revoked/i.test(message)) return "邀请已过期或撤销，请让管理员生成新的链接。";
  if (/access is disabled|membership disabled/i.test(message)) return "公司访问权限已停用，请让管理员在员工列表恢复权限。";
  if (/primary administrator|primary.*protected|only the primary|manage deputies/i.test(message)) return "正管理员身份受保护，副管理员任免只能由正管理员操作。";
  if (/rejoin|new invitation is required after removal/i.test(message)) return "该员工已被移除，需要重新邀请加入，不能直接恢复。";
  if (/employee quota/i.test(message)) return "公司成员额度已满，请联系 JomSales 负责人调整配套。";
  if (/own account|Administrator accounts are protected/i.test(message)) return "不能停用自己或管理员账号；此页面只管理销售员的访问权限。";
  if (/PGRST|schema cache|function .* does not exist/i.test(message) || error?.code === "PGRST202") return "员工邀请或产品权限数据库功能尚未配置，请先执行对应的新 SQL，再刷新。";
  return `操作未确认：${message || "请检查网络后重试"}。若网络中断，请先刷新核对结果。`;
}
