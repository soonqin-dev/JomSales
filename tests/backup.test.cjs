const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { execFileSync } = require("node:child_process");
const vm = require("node:vm");
const strip = file => readFileSync(join(__dirname, "..", file), "utf8").replace(/^import .*$/gm, "").replace(/export /g, "");
const ctx = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Date, JSON, String, Math });
vm.runInContext(strip("lib/zip.js") + strip("lib/backup.js") + ";globalThis.api={crc32,zipStore,csvCell,quotationsCsv,quotationItemsCsv,customersCsv,productsCsv,safeFileName}", ctx);
const api = ctx.api;

test("crc32 matches the standard check value", () => {
  assert.equal(api.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zip archive is readable by the system unzip tool with UTF-8 names", t => {
  const dir = mkdtempSync(join(tmpdir(), "jomsales-zip-"));
  try {
    const enc = new TextEncoder();
    const archive = api.zipStore([{ name: "报价/Q-0001.pdf", data: enc.encode("%PDF-1.4 test") }, { name: "客户.csv", data: enc.encode("a,b\r\n") }]);
    const file = join(dir, "backup.zip");
    writeFileSync(file, Buffer.from(archive));
    let listing;
    try { listing = execFileSync("tar", ["-tf", file], { encoding: "utf8" }); }
    catch { t.skip("no tar available to verify the archive"); return; }
    assert.match(listing, /Q-0001\.pdf/);
    assert.match(listing, /\.csv/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("backup CSVs escape quotes and neutralise spreadsheet formulas", () => {
  assert.equal(api.csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(api.csvCell(null), '""');
  const csv = api.quotationsCsv([{ number: "Q-1", status: "paid", customer_name: "Ali, \"Big\"", total_amount: "12.50", deleted_at: null }]);
  assert(csv.startsWith("﻿"));
  assert.match(csv, /"Q-1".*"已收款"/);
  assert.match(csv, /"Ali, ""Big"""/);
  const items = api.quotationItemsCsv([{ number: "Q-1", items: [{ product: { serial: "P-1", name: "Widget", temporary: true }, quantity: 2, unitPrice: 5 }] }]);
  assert.match(items, /"Q-1","1","P-1","Widget","","2","5","临时项目"/);
  assert.match(api.productsCsv([{ serial: "-5", tags: ["a", "b"] }]), /"'-5"/);
  assert.equal(api.safeFileName('a/b:c*"d'), "a_b_c__d");
});
