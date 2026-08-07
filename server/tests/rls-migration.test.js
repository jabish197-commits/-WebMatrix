import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("RLS migration protects every application table", async () => {
  const sql = await readFile(new URL("../supabase/row-level-security.sql", import.meta.url), "utf8");
  for (const table of ["users", "site_settings", "banners", "products", "orders", "order_items", "password_reset_tokens", "audit_logs"]) {
    assert.match(sql, new RegExp(`'${table}'`), table);
  }
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all privileges on all tables in schema public from anon, authenticated/i);
  assert.match(sql, /grant all privileges on all tables in schema public to service_role/i);
});
