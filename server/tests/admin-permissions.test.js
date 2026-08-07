import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("admin management routes and resources enforce named permissions", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /patch\("\/api\/admins\/:id\/permissions"/);
  assert.match(source, /manage\/products[^\n]+requirePermission\("catalog\.manage"\)/);
  assert.match(source, /manage\/orders[^\n]+requirePermission\("orders\.manage"\)/);
  assert.match(source, /api\/users[^\n]+requirePermission\("customer\.view"\)/);
});
