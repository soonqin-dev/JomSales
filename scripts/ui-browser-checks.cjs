// Presentation checks using the same local-only fixture as the business regression.
const assert = require("node:assert/strict");
const { join } = require("node:path");
async function auditUi(page, name, { screenshot = true } = {}) {
  // Review the resting layout, not a transient input focus/keyboard state.
  await page.evaluate(() => document.activeElement?.blur());
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForFunction(() => [...document.querySelectorAll('img[src^="/figma/"]')].every(img => img.complete));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const issues = await page.evaluate(() => {
      const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== "hidden";
      const roots = document.querySelector("dialog[open]") ? [document.querySelector("dialog[open]")] : [...document.querySelectorAll("main")];
      const issues = [];
      if (document.documentElement.scrollWidth > innerWidth) issues.push("horizontal document overflow");
      for (const root of roots) {
        if (root.scrollWidth > root.clientWidth + 1) issues.push("horizontal content overflow");
        for (const element of root.querySelectorAll("button, .uiButton")) {
          if (visible(element) && element.getBoundingClientRect().height < 43.5) issues.push("small target: " + element.textContent);
        }
        for (const element of root.querySelectorAll("input:not([type=file]):not([type=checkbox]), textarea")) {
          if (visible(element) && parseFloat(getComputedStyle(element).fontSize) < 16) issues.push("small input text");
        }
        for (const img of root.querySelectorAll('img[src^="/figma/"]')) {
          if (visible(img) && (!img.complete || !img.naturalWidth)) issues.push("missing asset: " + img.getAttribute("src"));
          if (visible(img)) {
            const expected = { "profile.svg": [24,24], "quotation.svg": [24,24], "search.svg": [11,11], "add.svg": [14,14], "quotation-fab.svg": [46,46], "home-fab.svg": [46,46], "count.svg": [17,17], "divider.svg": [326,1] }[img.getAttribute("src").split("/").pop()];
            const rect = img.getBoundingClientRect();
            if (!expected || Math.abs(rect.height - expected[1]) > .5 || (expected[1] === 1 ? rect.width > expected[0] + .5 : Math.abs(rect.width - expected[0]) > .5)) issues.push("incorrect asset geometry: " + img.getAttribute("src"));
          }
        }
      }
      return issues;
    });
    assert.deepEqual(issues, [], `${name} at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (screenshot && process.env.SALESGO_TEST_SCREENSHOTS) {
    await page.screenshot({ path: join(process.env.SALESGO_TEST_SCREENSHOTS, `salesgo-${name}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: join(process.env.SALESGO_TEST_SCREENSHOTS, `salesgo-${name}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
  }
  console.log(`PASS UI ${name}: 320/390/768/1280px, 44px targets, 16px inputs, local Figma assets`);
}
module.exports = { auditUi };
