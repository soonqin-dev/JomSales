const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const context = vm.createContext({});
vm.runInContext(readFileSync(join(__dirname,"../lib/account-utils.js"),"utf8").replace(/export /g,"")+";globalThis.api={profileFields,validatePassword,memberLabel,nullableLimit}",context);
const api=context.api;
test("profile name and international phone validation",()=>{
  assert.equal(api.profileFields("  张三  ","+60 12-345 6789").displayName,"张三");
  assert.equal(api.profileFields("Ryan","+60 12-345 6789").whatsapp,"+60123456789");
  assert.equal(api.profileFields("Ryan","").whatsapp,"");
  for(const args of [["", ""],["x".repeat(121),""],["Ryan","0123456789"],["Ryan","+0123456789"]])assert.throws(()=>api.profileFields(...args));
});
test("password confirmation and nullable plan limits",()=>{
  assert.equal(api.validatePassword("secure-password","secure-password"),"secure-password");
  assert.equal(api.validatePassword('Ab!123','Ab!123'),'Ab!123');assert.equal(api.validatePassword('x'.repeat(128),'x'.repeat(128)).length,128);assert.throws(()=>api.validatePassword('x'.repeat(129),'x'.repeat(129)));
  assert.throws(()=>api.validatePassword("short","short"));assert.throws(()=>api.validatePassword("secure-password","different-password"));
  assert.equal(api.nullableLimit(""),null);assert.equal(api.nullableLimit("5"),5);
  for(const value of ["1.5","0","-1","NaN"])assert.throws(()=>api.nullableLimit(value));
});
test("role label distinguishes primary and deputy without changing underlying admin permissions",()=>{
  assert.equal(api.memberLabel({role:"admin",is_primary:true}),"正管理员");
  assert.equal(api.memberLabel({role:"admin",is_primary:false}),"副管理员");
  assert.equal(api.memberLabel({role:"sales"}),"销售员");
});
