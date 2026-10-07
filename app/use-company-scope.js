"use client";
import { useMember } from "./member-context";

// Secondary workspace screens read the verified scope held by the (member) layout,
// which rechecks live membership on focus and every two minutes.
export default function useCompanyScope(adminOnly = false) {
  const member = useMember();
  if (!member) return { context: null, error: "公司访问权限不可用，请重新登录。" };
  if (adminOnly && member.role !== "admin") return { context: null, error: "此页面仅供该公司管理员使用。" };
  return { context: member, error: "" };
}
