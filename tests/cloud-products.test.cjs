const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto").webcrypto;

const utilities = readFileSync(join(__dirname, "../app/quotation-utils.js"), "utf8").replace(/export /g, "");
const source = readFileSync(join(__dirname, "../lib/supabase/products.js"), "utf8").replace(/^import .*;\r?\n/m, "").replace(/export /g, "");
const context = vm.createContext({ crypto, TextEncoder, fetch, Blob, Map, Set });
vm.runInContext(utilities + "\n" + source + "\nglobalThis.api = { productFields, signedProducts, readProducts, saveProduct, deleteProduct };", context);
const api = context.api;
const COMPANY = "10000000-0000-4000-a000-000000000001";
const base = { id: "10000000-0000-4000-a000-000000000002", serial: "P-1", name: "Product", tags: [], price: "10.00", image: "" };

function client({ existing = [], writeError = false, noMatch = false, removeError = false, lostReply = false, photoError = false, numericPrices = false } = {}) {
  const rows = [...existing], uploads = [], removals = [], ranges = [], batches = [];
  const storage = {
    upload: async (path, blob, options) => { uploads.push({ path, blob, options }); return { error: null }; },
    remove: async paths => { removals.push(paths); return { data: removeError ? [] : paths.map(name => ({ name })), error: removeError ? { message: "Cleanup denied" } : null }; },
    createSignedUrls: async (paths, expiry) => { batches.push({ paths, expiry }); return { data: paths.map(path => ({ path, error: photoError ? "Not found" : null, signedUrl: photoError ? null : `https://example.test/${path}` })), error: null }; }
  };
  const instance = {
    from() {
      let action = "select", payload, filters = {};
      const q = {
        select: () => q, eq: (key, value) => { filters[key] = value; return q; },
        is: (key, value) => { filters[key] = value; return q; }, order: () => q,
        insert: value => { action = "insert"; payload = value; return q; },
        update: value => { action = "update"; payload = value; return q; },
        range: async (start, end) => { ranges.push([start, end]); return { data: rows.slice(start, end + 1), error: null }; },
        maybeSingle: async () => {
          if (action === "select") return { data: rows.find(row => Object.entries(filters).every(([k, v]) => row[k] === v)) || null, error: null };
          if (noMatch) return { data: null, error: null };
          if (writeError && !lostReply) return { data: null, error: { message: "Network failure" } };
          const row = { deleted_at: null, ...(action === "update" ? rows.find(r => r.id === filters.id) : {}), ...payload, revision: 2 };
          if (numericPrices) row.price = Number(row.price);
          rows.push(row);
          return lostReply ? { data: null, error: { message: "Response lost" } } : { data: row, error: null };
        }
      }; return q;
    },
    storage: { from: () => storage }
  };
  instance.rpc = async (name, args) => {
    assert.equal(name, "search_company_products");
    const offset = args.after_id ? Number(args.after_id) + 1 : 0;
    ranges.push([offset,offset+49]);
    const items = rows.slice(offset,offset+30);
    return { data: { items, total: rows.length, has_more: offset+30 < rows.length, cursor: items.length ? { id: items.at(-1).id, created_at: "2026-10-06" } : null } };
  };
  return { instance, rows, uploads, removals, ranges, batches };
}

test("cloud fields enforce database-compatible limits before uploads", () => {
  assert.equal(api.productFields({ ...base, serial: " P-1 ", price: "0" }).price, "0.00");
  for (const changed of [{ serial: " " }, { name: "X".repeat(241) }, { tags: Array(21).fill("x") }, { price: "-1" }, { price: "10000000" }, { price: "1.999" }]) {
    assert.throws(() => api.productFields({ ...base, ...changed }));
  }
});

test("cloud update reuses unchanged images and reports nonfatal old-image cleanup failures", async () => {
  const previous = { ...base, image: "https://example.test/old", image_path: "old-path", revision: 1 };
  const unchanged = client({ existing: [previous] });
  const saved = await api.saveProduct(unchanged.instance, COMPANY, previous, previous);
  assert.equal(saved.row.image_path, "old-path"); assert.equal(unchanged.uploads.length, 0);
  const changed = client({ existing: [previous], removeError: true });
  const replaced = await api.saveProduct(changed.instance, COMPANY, { ...previous, image: "data:image/png;base64,aGVsbG8=" }, previous);
  assert.equal(changed.uploads.length, 1); assert.equal(changed.uploads[0].options.upsert, false);
  assert(replaced.warning.includes("清理"));
});

test("failed/stale writes clean only newly uploaded images; broken existing images retain their paths", async () => {
  const previous = { ...base, image: "https://example.test/old", image_path: "old", revision: 1 };
  const failed = client({ existing: [previous], noMatch: true });
  await assert.rejects(api.saveProduct(failed.instance, COMPANY, { ...previous, image: "data:image/png;base64,aGVsbG8=" }, previous), /其他设备/);
  assert.equal(failed.removals.length, 1); assert.notEqual(failed.removals[0][0], "old");
  const broken = client({ existing: [previous] });
  const saved = await api.saveProduct(broken.instance, COMPANY, { ...base }, { ...previous, image: "", imageError: "Missing image" });
  assert.equal(saved.row.image_path, "old");
});

test("catalog reads only one page and signs only that page, with explicit next cursor", async () => {
  const fixture = Array.from({ length: 601 }, (_, i) => ({ ...base, id: String(i), image_path: `image-${i}` }));
  const mock = client({ existing: fixture });
  const data = await api.readProducts(mock.instance, COMPANY);
  assert.equal(data.items.length, 30); assert.equal(data.total, 601); assert.equal(mock.ranges.length, 1);
  assert.equal(mock.batches.length, 1); assert(mock.batches.every(batch => batch.paths.length <= 30 && batch.expiry === 300));
  assert.equal((await api.readProducts(mock.instance, COMPANY, { cursor: data.cursor })).items[0].id, "30");
  const missing = client({ photoError: true });
  const signed = await api.signedProducts(missing.instance, [{ ...base, image_path: "missing" }]);
  assert(signed[0].imageError); assert.equal(signed[0].image, "");
});

test("new cloud products have no legacy source; editing preserves existing imported metadata", async () => {
  const fresh = client(); await api.saveProduct(fresh.instance, COMPANY, base);
  assert.equal(fresh.rows[0].source_key, null);
  const previous = { ...base, source_key: "existing-cloud-source", revision: 1 };
  const existing = client({ existing: [previous] });
  const saved = await api.saveProduct(existing.instance, COMPANY, { ...base, name: "Edited" }, previous);
  assert.equal(saved.row.source_key, "existing-cloud-source");
});

test("lost product reply recovers numeric SQL price and fresh insert retry never duplicates",async()=>{
  const mock=client({lostReply:true,numericPrices:true});
  const saved=await api.saveProduct(mock.instance,COMPANY,base);
  assert.equal(saved.row.price,10);assert.match(saved.warning,/核对/);assert.equal(mock.rows.length,1);
  const retry=await api.saveProduct(mock.instance,COMPANY,base);
  assert.equal(retry.row.id,base.id);assert.equal(mock.rows.length,1);
  await assert.rejects(api.saveProduct(mock.instance,COMPANY,{...base,name:"Changed after lost response"}),/不同的云端记录/);
});

test("delete is soft, clears the photo reference before cleanup, and checks stale revision", async () => {
  const previous = { ...base, image_path: "old", revision: 1 };
  const mock = client({ existing: [previous] });
  await api.deleteProduct(mock.instance, COMPANY, previous);
  const row = mock.rows[mock.rows.length - 1]; assert(row.deleted_at); assert.equal(row.image_path, null);
  assert.equal(mock.removals[0][0], "old");
  const stale = client({ noMatch: true });
  await assert.rejects(api.deleteProduct(stale.instance, COMPANY, previous), /修改或删除/);
  assert.equal(stale.removals.length, 0);
});
