import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, validateEmail } from "../src/validators/emailValidator.js";

test("normalizes a valid email", () => {
  assert.equal(normalizeEmail("  Customer@Gmail.com "), "customer@gmail.com");
  assert.equal(validateEmail("customer@gmail.com").valid, true);
});

test("rejects malformed email addresses", () => {
  for (const email of ["customer", "@gmail.com", "a..b@gmail.com", "a@-mail.com", "a@mail", "a@mail.c"]) {
    assert.equal(validateEmail(email).valid, false, email);
  }
});

test("suggests corrections for common provider typos", () => {
  assert.equal(validateEmail("customer@gamil.com").message, "Did you mean customer@gmail.com?");
});
