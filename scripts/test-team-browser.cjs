// Optional isolated mobile-browser acceptance. All Supabase calls are mocked;
// never creates real accounts, invitations, files or email.
const { chromium } = require(process.env.SALESGO_PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const base = process.env.SALESGO_TEST_URL || "http://localhost:3000";
const uuid = n => `20000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const company = uuid(10), anotherCompany = uuid(11);
const users = Object.fromEntries(["admin", "employee", "wrong"].map((key, i) => [key, {
  id: uuid(i+1), email: `${key}@example.test`, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString()
}]));
const encode = object => Buffer.from(JSON.stringify(object)).toString("base64url");
const session = user => ({ user, access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, role: "authenticated", exp: Math.floor(Date.now()/1000)+3600 })}.test`, refresh_token: "test", expires_in: 3600, token_type: "bearer" });
const invitations = [];
const errors = [];
let joined = false, active = true, failCreate = false, acceptedCalls = 0;
let registered = false;
let canManage = false, failPermission = false;
let holdNextPermissionRead = false, permissionReadStarted, releasePermissionRead;

(async () => {
  const browser = await chromium.launch({ channel: process.env.SALESGO_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    async function open() {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      let current = null;
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", dialog => dialog.accept());
      // Also ensure fragments never reach any network request/referrer.
      page.on("request", request => {
        assert(!request.url().includes("#token="));
        assert(!Object.values(request.headers()).some(value => value.includes("#token=")));
      });
      await context.route("https://*.supabase.co/**", async route => {
        const request = route.request(), url = new URL(request.url());
        let data, status = 200;
        const payload = request.method() === "POST" ? request.postDataJSON() : {};
        if (url.pathname.endsWith("/token")) {
          current = Object.values(users).find(u => u.email === payload.email); assert(current);
          data = session(current);
        } else if (url.pathname.endsWith("/signup")) {
          registered = true; assert.equal(url.searchParams.get("redirect_to"), base + "/auth/callback");
          assert.equal(payload.email, users.employee.email); data = { user: users.employee, session: null };
        } else if (url.pathname.endsWith("/user")) data = current;
        else if (url.pathname.endsWith("/logout")) { current = null; data = {}; }
        else if (url.pathname.endsWith("/company_members")) {
          data = current?.id === users.admin.id ? [{ company_id: company, role: "admin", companies: { id: company, name: "Test Company A" } }]
            : current?.id === users.employee.id ? [
              { company_id: anotherCompany, role: "sales", companies: { id: anotherCompany, name: "Already joined Company B" } },
              ...(joined && active ? [{ company_id: company, role: "sales", can_manage_products: canManage, companies: { id: company, name: "Test Company A" } }] : [])
            ] : [];
          const requestedCompany = url.searchParams.get("company_id")?.replace(/^eq\./, "");
          if (requestedCompany) data = data.filter(member => member.company_id === requestedCompany);
          if (holdNextPermissionRead && url.searchParams.get("select") === "role,can_manage_products") {
            holdNextPermissionRead = false;
            permissionReadStarted();
            await new Promise(resolve => { releasePermissionRead = resolve; });
          }
        } else if (url.pathname.endsWith("/products")) {
          const requestedCompany = url.searchParams.get("company_id")?.replace(/^eq\./, "");
          assert.equal(requestedCompany, company, "joined-company link must not choose the first unrelated membership");
          data = [{ id: uuid(22), company_id: company, serial: "A-001", name: "Shared team product", tags: [], price: 1, revision: 1, image_path: null, deleted_at: null }];
        } else if (url.pathname.includes("/rpc/")) {
          const rpc = url.pathname.split("/").pop();
          if (["get_company_team_permissions", "get_company_invitations", "create_employee_invite", "set_employee_active", "set_employee_product_permission", "revoke_employee_invite"].includes(rpc) && current?.id !== users.admin.id) {
            status = 403; data = { message: "Administrator access required." };
          } else if (rpc === "get_company_team_permissions") {
            assert.equal(payload.target_company, company);
            data = [{ user_id: users.admin.id, email: users.admin.email, role: "admin", active: true }, ...(joined ? [{ user_id: users.employee.id, email: users.employee.email, role: "sales", active, can_manage_products: canManage }] : [])];
          } else if (rpc === "get_company_invitations") {
            data = invitations.map(({ token, ...row }) => row);
          } else if (rpc === "create_employee_invite") {
            assert.equal(payload.target_company, company); assert.match(payload.invite_token, /^[0-9a-f]{64}$/);
            let row = invitations.find(i => i.token === payload.invite_token);
            if (!row) {
              for (const previous of invitations) if (previous.email === payload.invited_email && !previous.accepted_at) previous.revoked_at = new Date().toISOString();
              row = { id: uuid(100+invitations.length), email: payload.invited_email, expires_at: new Date(Date.now()+7*86400000).toISOString(), accepted_at: null, revoked_at: null, token: payload.invite_token };
              invitations.push(row);
            }
            if (failCreate) { failCreate = false; status = 500; data = { message: "Simulated lost response" }; }
            else data = row.id;
          } else if (rpc === "get_employee_invite" || rpc === "accept_employee_invite") {
            const row = invitations.find(i => i.token === payload.invite_token);
            if (rpc === "accept_employee_invite") acceptedCalls++;
            if (!row || row.email !== current?.email || row.revoked_at || (!row.accepted_at && new Date(row.expires_at).getTime() <= Date.now())) {
              status = 403; data = { message: "Invitation invalid, expired, revoked or for another email." };
            } else if (rpc === "get_employee_invite") data = [{ company_id: company, company_name: "Test Company A", email: row.email, expires_at: row.expires_at, already_accepted: !!row.accepted_at }];
            else if (!active) { status = 403; data = { message: "Company access is disabled." }; }
            else { joined = true; row.accepted_at = new Date().toISOString(); data = company; }
          } else if (rpc === "set_employee_active") {
            assert.equal(payload.target_company, company); assert.equal(payload.employee_id, users.employee.id);
            active = payload.enabled; data = null;
          } else if (rpc === "set_employee_product_permission") {
            assert.equal(payload.target_company, company); assert.equal(payload.employee_id, users.employee.id);
            if (failPermission) { failPermission = false; status = 500; data = { message: "Simulated permission save failure" }; }
            else { canManage = payload.enabled; data = null; }
          } else if (rpc === "revoke_employee_invite") {
            invitations.find(i => i.id === payload.invitation_id).revoked_at = new Date().toISOString(); data = null;
          } else throw new Error(`Unexpected RPC ${rpc}`);
        } else throw new Error(`Unexpected Supabase request ${url.pathname}`);
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      });
      return { page, context };
    }
    async function login(page, user) {
      await page.goto(base + "/account");
      await page.getByLabel("邮箱", { exact: true }).fill(user.email);
      await page.getByLabel("密码", { exact: true }).fill("test-password");
      await page.locator("button[type=submit]").click();
      await page.getByRole("heading", { name: "已登录" }).waitFor();
    }
    const { page: admin } = await open();
    await login(admin, users.admin);
    await admin.getByRole("link", { name: "员工与邀请 →" }).click();
    await admin.getByRole("heading", { name: "Test Company A", exact: true }).waitFor();
    assert.equal(await admin.getByRole("button", { name: "停用权限" }).count(), 0, "admin has no self-disable control");
    await admin.getByLabel("员工邮箱").fill("employee@example.test");
    failCreate = true;
    await admin.getByRole("button", { name: "生成邀请链接" }).click();
    await admin.getByRole("alert").filter({ hasText: "Simulated lost response" }).waitFor();
    await admin.getByRole("button", { name: "生成邀请链接" }).click();
    await admin.getByLabel("邀请链接").waitFor();
    const link = await admin.getByLabel("邀请链接").inputValue();
    assert.match(link, /\/join#token=[0-9a-f]{64}$/); assert.equal(invitations.length, 1);
    await admin.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async value => { window.testCopiedLink = value; } } }));
    await admin.getByRole("button", { name: "复制邀请链接" }).click();
    await admin.getByRole("status").filter({ hasText: "邀请链接已复制" }).waitFor();
    assert.equal(await admin.evaluate(() => window.testCopiedLink), link);
    await admin.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Clipboard unavailable"); } } }));
    await admin.getByRole("button", { name: "复制邀请链接" }).click();
    await admin.getByRole("status").filter({ hasText: "手动全选复制" }).waitFor();
    assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    const { page: employee } = await open();
    await employee.goto(link);
    await employee.getByRole("heading", { name: "请先登录受邀邮箱" }).waitFor();
    assert.equal(new URL(employee.url()).hash, "");
    assert.equal(await employee.getByText("Test Company A", { exact: true }).count(), 0, "anonymous invite never exposes company");
    await employee.getByRole("link", { name: "注册／登录员工账号 →" }).click();
    await employee.getByRole("button", { name: "注册员工账号" }).click();
    await employee.getByLabel("邮箱", { exact: true }).fill(users.employee.email);
    await employee.getByLabel("密码（至少 8 个字符）").fill("test-password");
    await employee.getByRole("button", { name: "注册并验证邮箱" }).click();
    await employee.getByRole("status").filter({ hasText: "注册申请已提交" }).waitFor(); assert(registered);
    await login(employee, users.employee);
    assert.equal(await employee.getByRole("button", { name: "创建公司", exact: true }).count(), 0);
    await employee.getByRole("link", { name: "返回邀请并确认加入 →" }).click();
    await employee.getByRole("button", { name: "接受邀请并加入公司" }).waitFor();
    assert.equal(acceptedCalls, 0, "preview/login must not automatically accept invitation");
    await employee.getByRole("button", { name: "接受邀请并加入公司" }).click();
    await employee.getByRole("heading", { name: "已加入公司" }).waitFor();
    assert.equal(await employee.evaluate(() => sessionStorage.getItem("salesgo_pending_invite")), null);
    assert.equal(await employee.evaluate(() => localStorage.getItem("salesgo_pending_invite")), null);
    await employee.getByRole("link", { name: "进入公司云端产品 →" }).click();
    await employee.getByRole("button", { name: "查看 Shared team product 详情" }).waitFor();
    assert(await employee.getByRole("button", { name: "＋ 新增产品" }).isDisabled());
    await employee.goto(base + "/team?company=" + company);
    await employee.locator(".accountError").waitFor();
    assert.equal(await employee.getByRole("button", { name: "生成邀请链接" }).count(), 0);

    const { page: wrong } = await open();
    await login(wrong, users.wrong); await wrong.goto(link);
    await wrong.getByRole("alert").filter({ hasText: "受邀邮箱" }).waitFor();
    assert.equal(await wrong.getByRole("button", { name: "接受邀请并加入公司" }).count(), 0);
    await admin.getByRole("button", { name: "刷新员工与邀请" }).click();
    const permission = admin.getByRole("checkbox", { name: "employee@example.test 的产品管理权限" });
    await permission.waitFor(); assert.equal(await permission.isChecked(), false);
    failPermission = true;
    await permission.click();
    await admin.getByRole("alert").filter({ hasText: "Simulated permission save failure" }).waitFor();
    assert.equal(await permission.isChecked(), false, "failed save must not show permission as granted");
    await permission.click();
    await admin.getByRole("status").filter({ hasText: "已允许此销售员管理产品" }).waitFor();
    await admin.getByRole("button", { name: "停用权限" }).waitFor();
    assert.equal(await permission.isChecked(), true); assert.equal(canManage, true);
    assert(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.SALESGO_TEAM_SCREENSHOT) await admin.screenshot({ path: process.env.SALESGO_TEAM_SCREENSHOT, fullPage: true });
    await employee.goto(base + "/cloud?company=" + company);
    await employee.getByRole("button", { name: "查看 Shared team product 详情" }).waitFor();
    assert.equal(await employee.getByRole("button", { name: "＋ 新增产品" }).isDisabled(), false);
    assert.equal(await employee.getByRole("link", { name: "员工与邀请", exact: true }).count(), 0);
    assert.equal(await employee.getByRole("button", { name: "预览本地产品导入" }).count(), 0);
    await employee.getByRole("button", { name: "编辑 Shared team product" }).click();
    await employee.getByRole("button", { name: "保存修改" }).waitFor();
    holdNextPermissionRead = true;
    const readStarted = new Promise(resolve => { permissionReadStarted = resolve; });
    await employee.evaluate(() => window.dispatchEvent(new Event("focus")));
    await readStarted; // Old 'granted' response waits while a newer read revokes.
    await permission.click();
    await admin.getByRole("status").filter({ hasText: "已收回产品管理权限" }).waitFor();
    await employee.evaluate(() => window.dispatchEvent(new Event("focus")));
    await employee.getByText("你的产品权限：仅查看与分享。员工与权限设置仅限管理员。", { exact: true }).waitFor();
    assert.equal(await employee.getByRole("button", { name: "保存修改" }).count(), 0, "revocation closes stale editor");
    assert(await employee.getByRole("button", { name: "＋ 新增产品" }).isDisabled());
    const lateResponse = employee.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith("/company_members") && url.searchParams.get("select") === "role,can_manage_products";
    });
    releasePermissionRead(); await lateResponse;
    await employee.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await employee.getByRole("button", { name: "＋ 新增产品" }).isDisabled(), "late old permission response must not restore controls");
    await admin.getByRole("button", { name: "停用权限" }).waitFor();
    await admin.getByRole("button", { name: "停用权限" }).click();
    await admin.getByRole("button", { name: "恢复权限" }).waitFor();
    assert.equal(active, false);
    await permission.click();
    await admin.getByRole("status").filter({ hasText: "已允许此销售员管理产品" }).waitFor();
    await admin.getByRole("button", { name: "恢复权限" }).waitFor();
    assert.equal(canManage, true); assert.equal(active, false, "grant must not reactivate disabled member");
    await employee.goto(link);
    await employee.getByRole("button", { name: "确认公司访问权限" }).click();
    await employee.getByRole("alert").filter({ hasText: "已停用" }).waitFor(); assert.equal(active, false);
    await admin.getByRole("button", { name: "恢复权限" }).click();
    await admin.getByRole("button", { name: "停用权限" }).waitFor(); assert.equal(active, true);
    await employee.getByRole("button", { name: "确认公司访问权限" }).click();
    await employee.getByRole("heading", { name: "已加入公司" }).waitFor();

    await admin.getByLabel("员工邮箱").fill("wrong@example.test");
    await admin.getByRole("button", { name: "生成邀请链接" }).click();
    await admin.getByRole("status").filter({ hasText: "邀请已生成" }).waitFor();
    const revokeLink = await admin.getByLabel("邀请链接").inputValue();
    await admin.getByRole("button", { name: "撤销邀请" }).click();
    await admin.getByRole("status").filter({ hasText: "邀请已撤销" }).waitFor();
    assert.equal(await admin.getByLabel("邀请链接").count(), 0);
    await wrong.goto(revokeLink); await wrong.locator(".accountError").waitFor();
    assert.equal(await wrong.getByRole("button", { name: "接受邀请并加入公司" }).count(), 0);
    await admin.getByRole("link", { name: "← 公司账号" }).click();
    await admin.getByRole("button", { name: "退出此设备的登录" }).click();
    await admin.getByLabel("邮箱", { exact: true }).waitFor();
    await admin.goto(base + "/team");
    await admin.getByRole("link", { name: "请登录公司管理员账号并确认权限" }).waitFor();
    assert.equal(await admin.getByText(users.employee.email, { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: mobile invitations, product permission toggle/failure, grant without admin access, revoke closes editor, inactive override, registration/join, disable/restore, link revoke and logout. All Supabase calls mocked; no remote writes.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
