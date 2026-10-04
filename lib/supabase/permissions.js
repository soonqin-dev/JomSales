// UI hint only: Supabase RLS independently checks live membership on each write.
// Missing/unknown fields never grant a sales member write access.
export function canManageProducts(member) {
  return member?.active !== false && (member?.role === "admin" ||
    (member?.role === "sales" && member?.can_manage_products === true));
}
