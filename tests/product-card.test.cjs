const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const strip = file => readFileSync(join(__dirname, "..", file), "utf8").replace(/^import .*$/gm, "").replace(/export /g, "");
const source = strip("app/images.js") + strip("app/product-card.js");

function setup() {
  const texts = [];
  const ctx = { font: "", fillStyle: "", textBaseline: "", textAlign: "",
    measureText: text => ({ width: Array.from(text).length * 20 }),
    fillText: text => texts.push(String(text)), fillRect() {}, drawImage() {} };
  const canvas = { width: 0, height: 0, getContext: () => ctx,
    toBlob: (callback, type) => callback(new Blob(["jpg"], { type })) };
  const context = vm.createContext({
    Blob, File, Promise,
    Image: class { naturalWidth = 800; naturalHeight = 600; async decode() {} },
    document: { fonts: { ready: Promise.resolve() }, createElement: () => canvas }
  });
  vm.runInContext(source, context);
  return { create: context.createProductCard, texts };
}

const company = { name: "JomSales Sdn Bhd", logo: "" };

test("customer product card never draws a price or the goods/service type", async () => {
  const { create, texts } = setup();
  const file = await create({ name: "Sample Product A", serial: "TEST-JS-0001", price: "20.00", unit: "件", is_service: true,
    category: "测试产品", tags: ["分类", "材质"], image: "" }, company, { name: "RYAN", whatsapp: "+60123456789" });
  assert.equal(file.type, "image/jpeg");
  assert.ok(texts.some(text => text.includes("Sample Product A")));
  assert.ok(texts.some(text => text.includes("RYAN")));
  for (const text of texts) {
    assert.doesNotMatch(text, /RM/);
    assert.doesNotMatch(text, /20\.00/);
    assert.doesNotMatch(text, /服务/);
  }
});

test("cards still render for products with missing or invalid prices", async () => {
  for (const price of ["", "NaN", "abc"]) {
    const { create, texts } = setup();
    const file = await create({ name: "No Price", serial: "P-1", price, tags: [], image: "" }, company);
    assert.equal(file.name, "JomSales-P-1-product-card.jpg");
    assert.ok(!texts.some(text => /RM/.test(text)));
  }
});
