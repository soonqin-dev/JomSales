// Optional browser regression: install Playwright or set SALESGO_PLAYWRIGHT_MODULE
// to an existing installation. Run against `npm run start` on localhost:3000.
// Every Supabase request is mocked; this test never writes to the live project.
const { chromium } = require(process.env.SALESGO_PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const base = process.env.SALESGO_TEST_URL || "http://localhost:3000";
const uuid = n => `10000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const CA = uuid(11), CB = uuid(12);
const users = Object.fromEntries(["owner", "other", "sales", "disabled"].map((key, index) => [key, {
  id: uuid(index + 1), email: `${key}@example.test`, aud: "authenticated", role: "authenticated",
  app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString()
}]));
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function session(user) {
  return { user, access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, role: "authenticated" })}.test`, refresh_token: "test", expires_in: 3600, token_type: "bearer" };
}
const products = [{ id: uuid(22), company_id: CB, serial: "B-001", name: "Company B only", tags: [], price: 20, image_path: null, revision: 1, created_at: "2026-01-01", deleted_at: null, source_key: null }];
const images = new Map();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZHkAAAAASUVORK5CYII=", "base64");
let failSave = false;
let failList = false;
let salesCanManage = false;
const errors = [];

(async () => {
  const browser = await chromium.launch({ channel: process.env.SALESGO_BROWSER_CHANNEL || "msedge", headless: true });
  try {
    async function open(key) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      page.on("pageerror", err => errors.push(err.message));
      page.on("dialog", dialog => dialog.accept());
      await context.route("https://*.supabase.co/**", async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        let data, status = 200;
        const user = users[key];
        const company = key === "other" ? CB : CA;
        const active = key !== "disabled";
        const admin = key === "owner" || key === "other";
        const writer = active && (admin || (key === "sales" && salesCanManage));
        const eq = column => url.searchParams.get(column)?.replace(/^eq\./, "");
        if (url.pathname.endsWith("/token")) data = session(user);
        else if (url.pathname.endsWith("/user")) data = user;
        else if (url.pathname.endsWith("/logout")) data = {};
        else if (url.pathname.endsWith("/company_members")) {
          data = active ? [{ company_id: company, role: admin ? "admin" : "sales", can_manage_products: key === "sales" && salesCanManage, companies: { id: company, name: company === CA ? "Company A" : "Company B" } }] : [];
        } else if (url.pathname.endsWith("/products")) {
          if (failList && method === "GET") {
            failList = false;
            await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST205", message: "Simulated missing schema" }) }); return;
          }
          let matching = products.filter(p => active && p.company_id === company && (!eq("company_id") || p.company_id === eq("company_id")) && (!eq("id") || p.id === eq("id")) && (!eq("source_key") || p.source_key === eq("source_key")) && (!eq("revision") || String(p.revision) === eq("revision")) && (url.searchParams.get("deleted_at") !== "is.null" || !p.deleted_at));
          if (method === "POST") {
            const payload = request.postDataJSON();
            const item = Array.isArray(payload) ? payload[0] : payload;
            if (failSave) { failSave = false; status = 500; data = { message: "Simulated network failure" }; }
            else if (!writer || item.company_id !== company || (!admin && item.source_key)) { status = 403; data = { message: "Permission denied" }; }
            else if (products.some(p => p.id === item.id || (!p.deleted_at && p.company_id === company && p.serial === item.serial))) { status = 409; data = { message: "Duplicate product" }; }
            else {
              const row = { ...item, revision: 1, created_at: new Date().toISOString(), deleted_at: null };
              products.unshift(row); data = [row];
            }
          } else if (method === "PATCH") {
            data = writer ? matching.map(row => { Object.assign(row, request.postDataJSON(), { revision: row.revision + 1 }); return row; }) : [];
          } else data = matching.slice(Number(url.searchParams.get("offset") || 0), Number(url.searchParams.get("offset") || 0) + Number(url.searchParams.get("limit") || 1000));
        } else if (url.pathname === "/storage/v1/object/sign/salesgo-products") {
          const body = request.postDataJSON(); assert.equal(body.expiresIn, 300);
          data = body.paths.map(path => ({ path, signedURL: `/object/sign/salesgo-products/${path}?token=test`, error: images.has(path) && active && path.startsWith(company + "/") ? null : "Denied" }));
        } else if (url.pathname.startsWith("/storage/v1/object/sign/salesgo-products/")) {
          await route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: png }); return;
        } else if (url.pathname.startsWith("/storage/v1/object/salesgo-products/") && method === "POST") {
          const path = url.pathname.slice("/storage/v1/object/salesgo-products/".length);
          assert(path.startsWith(company + "/")); assert.equal(request.headers()["x-upsert"], "false");
          images.set(path, png); data = { Key: path, Id: uuid(99) };
        } else if (url.pathname === "/storage/v1/object/salesgo-products" && method === "DELETE") {
          data = request.postDataJSON().prefixes.filter(path => !products.some(p => !p.deleted_at && p.image_path === path)).map(path => { images.delete(path); return { name: path }; });
        } else throw new Error(`Unexpected Supabase request: ${method} ${url.pathname}`);
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      });
      await page.goto(base + "/account");
      await page.getByLabel("邮箱", { exact: true }).fill(users[key].email);
      await page.getByLabel("密码", { exact: true }).fill("test-password");
      await page.locator("button[type=submit]").click();
      await page.getByRole("heading", { name: "已登录" }).waitFor();
      await page.goto(base + "/cloud");
      return { page, context };
    }

    const { page: owner } = await open("owner");
    await owner.getByRole("button", { name: "＋ 新增产品" }).click();
    await owner.getByPlaceholder("例如 P-003").fill("A-001");
    await owner.getByPlaceholder("例如 Sample Product C").fill("Cloud photo product");
    await owner.getByPlaceholder("0.00").fill("12.50");
    await owner.locator("input[type=file]").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await owner.getByAltText("预览", { exact: true }).waitFor();
    failSave = true;
    await owner.getByRole("button", { name: "保存产品", exact: true }).click();
    await owner.getByRole("alert").filter({ hasText: "Simulated network failure" }).waitFor();
    assert.equal(await owner.getByPlaceholder("例如 Sample Product C").inputValue(), "Cloud photo product");
    await owner.getByRole("button", { name: "保存产品", exact: true }).click();
    await owner.getByRole("button", { name: "查看 Cloud photo product 详情" }).waitFor();
    assert.equal(images.size, 1, "failed save upload should be cleaned");
    await owner.getByRole("button", { name: "查看 Cloud photo product 详情" }).click();
    const downloaded = owner.waitForEvent("download");
    await owner.getByRole("button", { name: "下载产品卡片" }).click();
    assert((await downloaded).suggestedFilename().endsWith(".jpg"));
    await owner.getByRole("button", { name: "关闭产品详情" }).click();

    const local = [{ id: "local-1", serial: "LOCAL-1", name: "Local backup product", price: "5.00", tags: [], image: "" }];
    await owner.evaluate(value => localStorage.setItem("salesgo_catalog_v1", JSON.stringify(value)), local);
    await owner.getByRole("button", { name: "预览本地产品导入" }).click();
    assert.equal(products.length, 2, "preview must not write");
    const backup = owner.waitForEvent("download");
    await owner.getByRole("button", { name: "下载本地备份" }).click();
    assert.equal((await backup).suggestedFilename(), "SalesGo-local-products-backup.json");
    await owner.getByRole("button", { name: "确认导入公司" }).click();
    await owner.getByRole("status").filter({ hasText: "导入完成：新增 1" }).waitFor();
    await owner.getByRole("button", { name: "预览本地产品导入" }).click();
    await owner.getByRole("button", { name: "确认导入公司" }).click();
    await owner.getByRole("status").filter({ hasText: "新增 0，跳过 1" }).waitFor();
    assert.deepEqual(await owner.evaluate(() => JSON.parse(localStorage.getItem("salesgo_catalog_v1"))), local);

    const { page: secondDevice } = await open("owner");
    await secondDevice.getByRole("button", { name: "查看 Cloud photo product 详情" }).waitFor();
    const { page: other } = await open("other");
    await other.getByRole("button", { name: "查看 Company B only 详情" }).waitFor();
    assert.equal(await other.getByRole("button", { name: "查看 Cloud photo product 详情" }).count(), 0);
    const { page: sales } = await open("sales");
    await sales.getByRole("button", { name: "查看 Cloud photo product 详情" }).waitFor();
    assert(await sales.getByRole("button", { name: "＋ 新增产品" }).isDisabled());
    assert(await sales.getByRole("button", { name: "编辑 Cloud photo product" }).isDisabled());
    salesCanManage = true;
    await sales.getByRole("button", { name: "刷新云端产品" }).click();
    await sales.getByRole("button", { name: "查看 Cloud photo product 详情" }).waitFor();
    assert.equal(await sales.getByRole("button", { name: "＋ 新增产品" }).isDisabled(), false);
    assert.equal(await sales.getByRole("button", { name: "预览本地产品导入" }).count(), 0);
    assert.equal(await sales.getByRole("link", { name: "员工与邀请", exact: true }).count(), 0);
    await sales.getByRole("button", { name: "＋ 新增产品" }).click();
    await sales.getByPlaceholder("例如 P-003").fill("SALES-NEW");
    await sales.getByPlaceholder("例如 Sample Product C").fill("Sales managed product");
    await sales.getByPlaceholder("0.00").fill("8.00");
    await sales.locator("input[type=file]").setInputFiles({ name: "sales-photo.png", mimeType: "image/png", buffer: png });
    await sales.getByAltText("预览", { exact: true }).waitFor();
    await sales.getByRole("button", { name: "保存产品", exact: true }).click();
    await sales.getByRole("button", { name: "查看 Sales managed product 详情" }).waitFor();
    await sales.getByRole("button", { name: "编辑 Sales managed product" }).click();
    await sales.getByPlaceholder("例如 Sample Product C").fill("Sales edited product");
    await sales.getByRole("button", { name: "保存修改" }).click();
    await sales.getByRole("button", { name: "查看 Sales edited product 详情" }).waitFor();
    const salesRow = sales.locator("article").filter({ has: sales.getByRole("button", { name: "查看 Sales edited product 详情" }) });
    await salesRow.getByRole("button", { name: "删除", exact: true }).click();
    await sales.getByRole("status").filter({ hasText: "产品已删除" }).waitFor();
    assert(products.find(p => p.serial === "SALES-NEW").deleted_at);
    assert.equal(images.size, 1, "sales photo cleanup should remove its now-unused file");
    await sales.getByRole("button", { name: "编辑 Cloud photo product" }).click();
    salesCanManage = false; // Revoke while a stale product editor remains open.
    await sales.getByPlaceholder("例如 Sample Product C").fill("Revoked stale edit");
    await sales.getByRole("button", { name: "保存修改" }).click();
    await sales.getByRole("alert").filter({ hasText: "没有权限" }).waitFor();
    assert.equal(products.find(p => p.serial === "A-001").name, "Cloud photo product");
    await sales.getByRole("button", { name: "取消", exact: true }).click();
    await sales.getByRole("button", { name: "刷新云端产品" }).click();
    await sales.getByRole("button", { name: "查看 Cloud photo product 详情" }).waitFor();
    assert(await sales.getByRole("button", { name: "＋ 新增产品" }).isDisabled());
    const { page: disabled } = await open("disabled");
    await disabled.getByRole("alert").filter({ hasText: "权限已被停用" }).waitFor();
    assert.equal(await disabled.getByRole("button", { name: "查看 Cloud photo product 详情" }).count(), 0);

    failList = true;
    await owner.getByRole("button", { name: "刷新云端产品" }).click();
    await owner.getByRole("alert").filter({ hasText: "Simulated missing schema" }).waitFor();
    assert.equal(await owner.getByRole("button", { name: "查看 Local backup product 详情" }).count(), 0, "cloud errors must not fall back to local");
    await owner.getByRole("button", { name: "刷新云端产品" }).click();
    await owner.getByRole("button", { name: "查看 Cloud photo product 详情" }).waitFor();

    await owner.getByRole("button", { name: "编辑 Cloud photo product" }).click();
    products.find(p => p.serial === "A-001").revision++;
    await owner.getByPlaceholder("例如 Sample Product C").fill("Stale edit");
    await owner.getByRole("button", { name: "保存修改" }).click();
    await owner.getByRole("alert").filter({ hasText: "其他设备修改" }).waitFor();
    await owner.getByRole("button", { name: "取消", exact: true }).click();
    await owner.getByRole("button", { name: "刷新云端产品" }).click();
    await owner.getByRole("button", { name: "查看 Cloud photo product 详情" }).waitFor();
    await owner.getByRole("button", { name: "删除", exact: true }).first().click();
    await owner.getByRole("status").filter({ hasText: "产品已删除" }).waitFor();
    await owner.getByRole("button", { name: "预览本地产品导入" }).click();
    await owner.getByRole("button", { name: "确认导入公司" }).click();
    await owner.getByRole("status").filter({ hasText: "新增 0，跳过 1" }).waitFor();
    assert.equal(products.filter(p => p.source_key === "local-1").length, 1);
    assert(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.SALESGO_TEST_SCREENSHOT) await owner.screenshot({ path: process.env.SALESGO_TEST_SCREENSHOT, fullPage: true });
    await owner.goto(base + "/account");
    await owner.getByRole("button", { name: "退出此设备的登录" }).click();
    await owner.getByLabel("邮箱", { exact: true }).waitFor();
    await owner.goto(base + "/cloud");
    await owner.getByRole("link", { name: "请先登录并创建或加入公司" }).waitFor();
    assert.equal(await owner.getByRole("button", { name: "查看 Cloud photo product 详情" }).count(), 0);
    await owner.goto(base + "/");
    await owner.getByRole("button", { name: "查看 Local backup product 详情" }).waitFor();
    assert.equal(await owner.getByRole("button", { name: "查看 Cloud photo product 详情" }).count(), 0, "cloud rows must not pollute local catalog");
    assert.deepEqual(errors, []);
    console.log("PASS: cloud CRUD/images/cards, authorized sales CRUD and photo cleanup, permission revoke denies stale save, admin-only import, local preservation, company isolation, disabled accounts and revision conflicts. All remote requests mocked.");
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
