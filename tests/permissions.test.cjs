const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const context = vm.createContext({});
vm.runInContext(readFileSync(join(__dirname, "../lib/supabase/permissions.js"), "utf8").replace("export ", "") + ";globalThis.check=canManageProducts;", context);
test("product management UI grants sales only an explicit true flag, never a role upgrade", () => {
  const check = context.check;
  assert.equal(check({ role: "admin", can_manage_products: false }), true);
  assert.equal(check({ role: "sales", can_manage_products: true }), true);
  for (const flag of [false, undefined, null, "true", 1]) assert.equal(check({ role: "sales", can_manage_products: flag }), false);
  for (const member of [null, {}, { role: "unknown", can_manage_products: true }, { role: "sales", can_manage_products: true, active: false }, { role: "admin", active: false }]) assert.equal(check(member), false);
});
