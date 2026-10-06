// Production UI against a LOCAL API double. No live Supabase writes.
// Run npm run build afterwards to restore production-configured .next output.
const { chromium } = require(process.env.SALESGO_PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { createFixture } = require("./workspace-browser-fixture.cjs");
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const fixture = createFixture(), base = "http://localhost:54330", errors = [];
const next = join(__dirname, "../node_modules/next/dist/bin/next");
const env = { ...process.env, JOMSALES_BUILD_DIR: `.next-launchpad-workspace-${process.pid}`, NEXT_PUBLIC_SUPABASE_URL: fixture.origin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test_fixture" };
let server, browser, diagnosticPage;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function build() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [next, "build"], { env, stdio: "inherit" });
    child.on("error", reject); child.on("exit", code => code ? reject(Error(`Test build exited ${code}`)) : resolve());
  });
}
(async () => {
  try {
    await new Promise(resolve => fixture.server.listen(54329, resolve)); await build();
    server = spawn(process.execPath, [next, "start", "-p", "54330"], { env, stdio: "inherit" });
    let started = false;
    for (let i = 0; i < 60; i++) { try { await fetch(base + "/account"); started = true; break; } catch { await wait(250); } }
    assert(started);
    browser = await chromium.launch({ channel: process.env.SALESGO_BROWSER_CHANNEL || "msedge", headless: true });
    async function open(key = null, legacy = null) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage();
      page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
      if (legacy) await ctx.addInitScript(data => {
        for (const [key, value] of Object.entries(data)) if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
      }, legacy);
      await page.goto(base + "/"); await page.waitForURL("**/account");
      if (key) {
        await page.getByLabel("邮箱", { exact: true }).fill(fixture.users[key].email);
        await page.getByLabel("密码", { exact: true }).fill("fixture-password"); await page.locator("button[type=submit]").click();
        await page.getByRole("heading", { name: "公司云端产品", exact: true }).waitFor(); await ready(page);
      }
      return { page, ctx };
    }
    const button = (page, name) => page.getByRole("button", { name, exact: true });
    async function ready(page) { await page.waitForFunction(() => !!document.querySelector(".quotationCartButton") && !document.querySelector(".quotationCartButton").disabled); }
    async function editor(page) { await page.getByRole("button", { name: /查看 \/ 生成报价/ }).click(); await page.getByRole("heading", { name: "报价清单", exact: true }).waitFor(); }
    async function add(page) {
      await button(page, "查看 Cloud Widget 详情").click(); await button(page, "＋ 加入报价清单").click();
      await page.getByText("已加入当前报价，生成／分享时自动保存。", { exact: true }).waitFor(); await button(page, "关闭产品详情").click();
    }
    async function generate(page) {
      const download = page.waitForEvent("download"); await button(page, "生成报价 PDF").click();
      assert((await download).suggestedFilename().endsWith(".pdf")); await page.locator(".activeQuotation").filter({ hasText: /^新报价$/ }).waitFor();
      assert(!await page.getByRole("heading", { name: "报价清单", exact: true }).count()); assert.match(await page.locator(".quotationCartButton").innerText(), /0 项/);
    }
    async function select(page, id) {
      await page.goto(base + "/quotations"); await page.locator(`a[href$="quote=${id}"]`).click(); await ready(page);
      assert(!await page.getByRole("heading", { name: "报价清单", exact: true }).count());
      await page.locator(".activeQuotation").filter({ hasText: /正在编辑/ }).waitFor();
    }
    const anon = await open();
    for (const path of ["/cloud", "/team", "/brand", "/quotations", "/migration"]) {
      await anon.page.goto(base + path); await anon.page.waitForURL("**/account"); assert(!await button(anon.page, "查看 Cloud Widget 详情").count());
    }
    console.log("PASS anonymous protected routes");
    const legacy = { salesgo_catalog_v1: [{ id: "legacy", name: "Old Local Product" }], salesgo_quotation_v1: ["old"], salesgo_quotation_details_v1: { customerName: "Legacy Client" } };
    const owner = await open("owner", legacy), page = owner.page; diagnosticPage = page;
    const assertLegacy = async () => assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith("salesgo_")).map(key => [key, JSON.parse(localStorage.getItem(key))]))), legacy);
    await assertLegacy(); assert(!await page.getByText("Old Local Product", { exact: true }).count());
    await page.getByRole("link", { name: "公司品牌", exact: true }).click();
    await page.getByLabel("公司名称", { exact: true }).fill("Cloud Brand"); await page.getByLabel("公司联系方式").fill("+60 cloud phone");
    await page.getByLabel("公司 Logo", { exact: true }).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: fixture.png });
    await button(page, "保存公司品牌").click(); await page.getByText(/公司品牌已保存到云端/).waitFor();
    await page.getByRole("link", { name: "← 公司产品目录", exact: true }).click(); await ready(page);
    await button(page, "查看 Cloud Widget 详情").click(); await button(page, "下载产品卡片").waitFor();
    const jpg = page.waitForEvent("download"); await button(page, "下载产品卡片").click(); assert((await jpg).suggestedFilename().endsWith(".jpg")); await button(page, "关闭产品详情").click();
    await add(page); assert.equal(fixture.quotations.length, 0, "cart additions are memory-only"); await editor(page);
    assert(!await button(page, "保存到云端").count()); await page.getByLabel("客户名称 *", { exact: true }).fill("Cloud Client");
    await page.getByLabel("P-001 数量", { exact: true }).fill("2"); await page.getByLabel("折扣（RM）", { exact: true }).fill("5"); await generate(page);
    const quote = fixture.quotations[0], quoteId = quote.id;
    assert.equal(quote.customer_name, "Cloud Client"); assert.equal(quote.items[0].quantity, 2); assert.equal(quote.discount, "5.00");
    assert.equal(quote.status, "pending"); assert.equal(quote.creator_email, "owner@example.test"); assert.equal(quote.company_snapshot.name, "Cloud Brand");
    await page.reload(); await ready(page); assert.match(await page.locator(".quotationCartButton").innerText(), /0 项/);
    if (process.env.SALESGO_TEST_SCREENSHOTS) await page.screenshot({ path: join(process.env.SALESGO_TEST_SCREENSHOTS, "salesgo-quotation-catalog-mobile.png"), fullPage: true });
    console.log("PASS new-by-default, memory cart, PDF autosave/download, reset and legacy originals preserved");
    await select(page, quoteId); await add(page); await editor(page); assert.equal(await page.getByLabel("P-001 数量", { exact: true }).inputValue(), "3");
    const second = await open("owner"); await select(second.page, quoteId); await editor(second.page);
    await second.page.getByLabel("备注", { exact: true }).fill("Newer device note"); await generate(second.page);
    await page.getByLabel("备注", { exact: true }).fill("Stale note"); await button(page, "生成报价 PDF").click(); await page.getByText(/报价已被其他设备修改/).first().waitFor();
    assert.equal(quote.notes, "Newer device note"); assert.equal(await page.getByLabel("备注", { exact: true }).inputValue(), "Stale note");
    await button(page, "← 返回产品目录").click(); await button(page, "重新读取报价与品牌").click(); await ready(page); await editor(page);
    await page.getByLabel("备注", { exact: true }).fill("Retained failed save"); fixture.state.failQuote = true;
    await button(page, "生成报价 PDF").click(); await page.getByText(/Simulated quote save failure/).first().waitFor();
    assert.equal(await page.getByLabel("备注", { exact: true }).inputValue(), "Retained failed save"); await assertLegacy();
    // A failed PDF render after successful cloud save must not reset or duplicate.
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args) { return window.failPdf && this.width === 1588 ? null : original.apply(this, args); }; window.failPdf = true;
    });
    await button(page, "生成报价 PDF").click(); await page.getByText(/浏览器无法生成 PDF/).first().waitFor();
    assert.equal(fixture.quotations.length, 1); assert.equal(await page.getByLabel("备注", { exact: true }).inputValue(), "Retained failed save");
    await page.evaluate(() => { window.failPdf = false; }); await generate(page); assert.equal(fixture.quotations.length, 1);
    console.log("PASS selected quote returns to catalog, updates same id, stale/network/PDF failures retain contents");
    // Native share is mocked only to exercise cancellation/success deterministically.
    await select(page, quoteId); await editor(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", { configurable: true, value: async () => { if (window.abortShare) throw new DOMException("cancel", "AbortError"); } }); window.abortShare = true;
    });
    await button(page, "准备分享 PDF（自动保存）").click(); await button(page, "分享 PDF").waitFor(); await button(page, "分享 PDF").click();
    await page.getByText("分享已取消，当前报价保留，可重试分享或继续编辑。", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("客户名称 *", { exact: true }).inputValue(), "Cloud Client");
    await page.evaluate(() => { window.abortShare = false; }); await button(page, "分享 PDF").click(); await page.locator(".activeQuotation").filter({ hasText: /^新报价$/ }).waitFor();
    console.log("PASS prepared share retains user activation, cancellation retains quote, success resets");
    const sales = await open("sales"); diagnosticPage = sales.page;
    assert(!await button(sales.page, "＋ 新增产品").count()); assert(!await button(sales.page, "编辑 Cloud Widget").count()); assert(!await sales.page.locator(".cardActions .deleteButton").count());
    for (const width of [320, 390, 844]) { await sales.page.setViewportSize({ width, height: 844 }); assert(await sales.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); }
    await sales.page.setViewportSize({ width: 390, height: 844 }); await add(sales.page); await editor(sales.page);
    await sales.page.getByLabel("客户名称 *", { exact: true }).fill("Employee client"); await button(sales.page, "← 返回产品目录").click();
    sales.page.removeAllListeners("dialog"); sales.page.once("dialog", dialog => dialog.dismiss()); await button(sales.page, "＋ 新建报价单").click();
    await editor(sales.page); assert.equal(await sales.page.getByLabel("客户名称 *", { exact: true }).inputValue(), "Employee client"); sales.page.on("dialog", dialog => dialog.accept());
    await generate(sales.page); const employeeQuote = fixture.quotations.find(q => q.customer_name === "Employee client");
    await sales.page.goto(base + "/quotations"); await sales.page.getByRole("link", { name: "选择报价", exact: true }).waitFor(); assert.equal(await sales.page.getByRole("link", { name: "选择报价", exact: true }).count(), 1);
    assert(!await sales.page.getByText(/owner@example.test/).count());
    await button(sales.page, "标记为 Success（客户已成交）").click(); await button(sales.page, "标记为 Pending").waitFor(); assert.equal(employeeQuote.status, "success");
    await button(sales.page, "删除报价").click(); await sales.page.getByText("没有符合条件的已保存报价。", { exact: true }).waitFor();
    await button(sales.page, "回收站").click(); await button(sales.page, "恢复报价").waitFor(); assert.equal(employeeQuote.status, "success"); assert(employeeQuote.deleted_at);
    await button(sales.page, "恢复报价").click(); await sales.page.getByText("回收站没有符合条件的报价。", { exact: true }).waitFor();
    await button(sales.page, "返回已保存报价").click(); await sales.page.getByRole("link", { name: "选择报价", exact: true }).waitFor(); assert.equal(employeeQuote.deleted_at, null);
    await page.goto(base + "/quotations"); await page.getByText(/所属员工：sales@example.test/).waitFor(); assert.equal(await page.getByRole("link", { name: "选择报价", exact: true }).count(), 2);
    for (const width of [320, 390, 844]) { await page.setViewportSize({ width, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `history fits ${width}px`); }
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.SALESGO_TEST_SCREENSHOTS) await page.screenshot({ path: join(process.env.SALESGO_TEST_SCREENSHOTS, "salesgo-quotation-history-mobile.png"), fullPage: true });
    await page.getByLabel("搜索报价", { exact: true }).fill("sales@example.test"); assert.equal(await page.getByRole("link", { name: "选择报价", exact: true }).count(), 1);
    await select(page, employeeQuote.id); await add(page); await editor(page); await generate(page); assert.equal(employeeQuote.created_by, fixture.users.sales.id); assert.equal(employeeQuote.status, "success");
    await sales.page.goto(base + "/brand"); await sales.page.getByText(/此页面仅供该公司管理员使用/).waitFor();
    const other = await open("other"); assert(!await button(other.page, "查看 Cloud Widget 详情").count()); await other.page.goto(`${base}/cloud?company=${fixture.CA}&quote=${quoteId}`);
    await other.page.getByText(/你尚未加入公司/).first().waitFor();
    console.log("PASS own/admin history, employee email, search, Pending/Success, trash/restore and immutable owner");
    diagnosticPage = page;
    const cloudBefore = JSON.stringify(fixture.quotations);
    await page.goto(`${base}/migration?company=${fixture.CA}`); await page.waitForURL(`${base}/cloud?company=${fixture.CA}`); await ready(page); await assertLegacy();
    assert(!await page.getByRole("link", { name: "迁移旧浏览器资料", exact: true }).count()); assert.equal(JSON.stringify(fixture.quotations), cloudBefore);
    await page.goto(base + "/migration?company=https%3A%2F%2Fexample.test"); await page.waitForURL(base + "/cloud");
    await sales.page.goto(base + "/cloud"); await ready(sales.page); fixture.members.find(m => m.user_id === fixture.users.sales.id).can_manage_products = true;
    await sales.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await button(sales.page, "＋ 新增产品").waitFor(); await button(sales.page, "＋ 新增产品").click();
    fixture.members.find(m => m.user_id === fixture.users.sales.id).can_manage_products = false; await sales.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sales.page.locator(".overlay").waitFor({ state: "detached" });
    assert(!await button(sales.page, "＋ 新增产品").count()); fixture.members.find(m => m.user_id === fixture.users.sales.id).active = false;
    await sales.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await sales.page.getByText(/公司权限已被停用/).first().waitFor(); assert(!await button(sales.page, "查看 Cloud Widget 详情").count());
    await page.goto(base + "/account"); await button(page, "退出此设备的登录").click(); await page.getByLabel("邮箱", { exact: true }).waitFor(); await page.goto(base + "/cloud"); await page.waitForURL("**/account");
    console.log("PASS retired migration, product permission revocation, employee disable and logout");
    const forged = await browser.newContext(), fake = fixture.session(fixture.users.owner); fake.access_token = fake.access_token.replace(/[^.]+$/, "forged");
    await forged.addCookies([{ name: "sb-localhost-auth-token", value: "base64-" + encode(fake), domain: "localhost", path: "/" }]); const forgedPage = await forged.newPage();
    await forgedPage.goto(base + "/cloud"); await forgedPage.waitForURL("**/account");
    const refresh = await browser.newContext(), oldSession = fixture.session(fixture.users.owner); oldSession.expires_at = Math.floor(Date.now() / 1000) - 30;
    const oldCookie = "base64-" + encode(oldSession); await refresh.addCookies([{ name: "sb-localhost-auth-token", value: oldCookie, domain: "localhost", path: "/" }]);
    const refreshPage = await refresh.newPage(), response = await refreshPage.goto(base + "/"); await refreshPage.waitForURL("**/cloud"); await ready(refreshPage);
    assert((await refresh.cookies()).some(cookie => cookie.name.startsWith("sb-localhost-auth-token") && cookie.value !== oldCookie)); assert((response.headers()["cache-control"] || "").includes("no-store"));
    assert.deepEqual(errors, []); console.log("PASS forged session denial, cookie refresh and full workflow regression; API writes were local mocks");
  } catch (error) { if (diagnosticPage) console.error("Browser diagnostics", diagnosticPage.url(), await diagnosticPage.locator("body").innerText(), errors); throw error; }
  finally { await browser?.close(); server?.kill(); await new Promise(resolve => fixture.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
