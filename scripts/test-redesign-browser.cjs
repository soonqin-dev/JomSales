// Redesign regression against the LOCAL API double (no live Supabase writes).
// Install Playwright separately or set SALESGO_PLAYWRIGHT_MODULE; SALESGO_BROWSER_CHANNEL
// picks the installed browser (default msedge). Builds into its own folder, so the
// normal .next output is left alone.
const { chromium } = require(process.env.SALESGO_PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { createFixture } = require("./workspace-browser-fixture.cjs");
const fixture = createFixture(), base = "http://localhost:54330", errors = [], dialogs = [];
const next = join(__dirname, "../node_modules/next/dist/bin/next");
const env = { ...process.env, JOMSALES_BUILD_DIR: `.next-launchpad-redesign-${process.pid}`, NEXT_PUBLIC_SUPABASE_URL: fixture.origin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test_fixture" };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser;

async function build() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [next, "build"], { cwd: join(__dirname, ".."), env, stdio: "inherit" });
    child.on("error", reject); child.on("exit", code => code ? reject(Error(`Test build exited ${code}`)) : resolve());
  });
}

(async () => {
  try {
    await new Promise(resolve => fixture.server.listen(54329, resolve)); await build();
    server = spawn(process.execPath, [next, "start", "-p", "54330"], { cwd: join(__dirname, ".."), env, stdio: "inherit" });
    let started = false;
    for (let i = 0; i < 80; i++) { try { await fetch(base + "/account"); started = true; break; } catch { await wait(250); } }
    assert(started, "server did not start");
    browser = await chromium.launch({ channel: process.env.SALESGO_BROWSER_CHANNEL || "msedge", headless: true });

    async function login(key) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage();
      page.on("pageerror", error => errors.push(error.message));
      // Native dialogs are not part of the design system; any one is a regression.
      page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
      await page.goto(base + "/account");
      await page.locator("#account-email").fill(fixture.users[key].email);
      await page.locator("#account-password").fill("fixture-password");
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.waitForURL("**/cloud**"); await page.locator(".product-card").first().waitFor();
      return page;
    }
    const badge = page => page.locator(".nav-badge").textContent({ timeout: 2000 }).catch(() => null);

    // 1. Login lands on CAT with five navigation tabs.
    const owner = await login("owner");
    for (const label of ["产品", "客户", "报价单", "分享", "我的"]) await owner.getByRole("link", { name: new RegExp(label) }).first().waitFor();
    assert.equal(await owner.locator(".navbar .nav-item").count(), 5);

    // 2. Quick add merges one product into one line; the badge counts lines.
    const add = owner.getByRole("button", { name: "把 Cloud Widget 加入报价" });
    await add.click(); await add.click();
    assert.equal(await badge(owner), "1");

    // 3. FLOW.QUOTE_CONTINUE: switching pages keeps the in-memory quote.
    await owner.getByRole("link", { name: "客户" }).click(); await owner.waitForURL("**/customers");
    await owner.getByRole("link", { name: /报价单/ }).click(); await owner.waitForURL("**/cloud/quote");
    await owner.locator(".qte-item").first().waitFor();
    assert.equal(await owner.getByRole("textbox", { name: "P-001 数量" }).inputValue(), "2");

    // 4. Download autosaves, starts a file and returns to an empty CAT with LAST_PDF.
    await owner.getByRole("textbox", { name: "客户名称*" }).fill("Regression Customer");
    const download = owner.waitForEvent("download");
    await owner.getByRole("button", { name: "下载报价" }).click();
    assert.match((await download).suggestedFilename(), /\.pdf$/i);
    await owner.waitForURL("**/cloud"); await owner.getByText(/已保存/).first().waitFor();
    assert.equal(await badge(owner), null);

    // 5. The saved quote appears in QTL and reopens into QTE.
    await owner.goto(base + "/quotations"); await owner.locator(".data-card").first().waitFor();
    await owner.locator(".data-card").first().click(); await owner.waitForURL("**/cloud/quote");
    await owner.getByText(/正在编辑/).first().waitFor();

    // 6. A sales member without product permission sees no product CRUD controls.
    const sales = await login("sales");
    assert.equal(await sales.getByRole("button", { name: "新增产品" }).count(), 0);
    assert.equal(await sales.locator(".product-card .menu-anchor").count(), 0);
    await sales.goto(base + "/admin"); await sales.getByText("这个页面仅供公司管理员使用").waitFor();

    // 7. Admin pages render inside the shell.
    for (const path of ["/team", "/team/report", "/brand", "/catalog-settings?tab=import", "/me", "/me/profile", "/me/security"]) {
      await owner.goto(base + path); await owner.locator(".topbar-title").first().waitFor();
    }

    assert.deepEqual(dialogs, [], "native dialogs must not be used");
    assert.deepEqual(errors, [], "page errors");
    console.log("PASS: redesign regression");
  } catch (err) {
    console.error(err); console.error({ errors, dialogs }); process.exitCode = 1;
  } finally { await browser?.close(); server?.kill(); fixture.server.close(); }
})();
