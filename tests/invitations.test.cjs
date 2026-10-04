const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

function fixture(hash = "") {
  const storage = new Map();
  const history = [];
  const window = { location: { hash, pathname: "/join", search: "" }, sessionStorage: {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)
  }, history: { replaceState: (_, __, value) => history.push(value) } };
  const context = vm.createContext({ window, URLSearchParams, Uint8Array, crypto: webcrypto });
  const source = readFileSync(join(__dirname, "../lib/supabase/invitations.js"), "utf8").replace(/export /g, "");
  vm.runInContext(source + ";globalThis.api={newInviteToken,pendingInvite,captureInvite,validInviteToken,teamError};", context);
  return { api: context.api, storage, history };
}

test("invites use 256-bit random lowercase hexadecimal tokens", () => {
  const { api } = fixture();
  const tokens = Array.from({ length: 100 }, () => api.newInviteToken());
  assert(tokens.every(api.validInviteToken)); assert.equal(new Set(tokens).size, 100);
  for (const invalid of [null, "a".repeat(63), "A".repeat(64), "<script>"]) assert.equal(api.validInviteToken(invalid), false);
});
test("fragment is saved only in session storage then removed from the visible URL", () => {
  const token = "a".repeat(64), { api, history, storage } = fixture(`#token=${token}`);
  assert.equal(api.captureInvite(), token); assert.equal(api.pendingInvite(), token);
  assert.equal(storage.get("salesgo_pending_invite"), token); assert.deepEqual(history, ["/join"]);
});
test("missing and malformed links fail closed rather than accepting another pending link", () => {
  const missing = fixture(); assert.throws(() => missing.api.captureInvite(), /没有待接受/);
  const malformed = fixture("#token=broken"); malformed.storage.set("salesgo_pending_invite", "a".repeat(64));
  assert.throws(() => malformed.api.captureInvite(), /链接不完整/); assert.equal(malformed.history.length, 0);
  assert.equal(malformed.api.pendingInvite(), null);
});
test("existing invitation survives account navigation, and errors explain recovery", () => {
  const { api, storage } = fixture(); storage.set("salesgo_pending_invite", "b".repeat(64));
  assert.equal(api.captureInvite(), "b".repeat(64));
  assert.match(api.teamError({ message: "Company access is disabled." }), /停用/);
  assert.match(api.teamError({ message: "Invitation invalid or for another email." }), /受邀邮箱/);
  assert.match(api.teamError({ code: "PGRST202" }), /执行员工邀请 SQL/);
});
