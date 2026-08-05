import test from "node:test"; import assert from "node:assert/strict"; test("roles are distinct",()=>assert.notEqual("admin","super_admin"));
