import test from "node:test";
import assert from "node:assert/strict";
import { getSmtpConfig, getSmtpStatus } from "../src/services/emailService.js";

test("SMTP configuration supports Gmail TLS", () => {
  const config = getSmtpConfig({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "shop@gmail.com", SMTP_PASS: "app-password", SMTP_FROM: "WebMatrix <shop@gmail.com>" });
  assert.equal(config.secure, true);
  assert.equal(config.port, 465);
  assert.equal(config.from, "WebMatrix <shop@gmail.com>");
});

test("SMTP configuration supports STARTTLS and rejects missing secrets", () => {
  assert.equal(getSmtpConfig({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USER: "mail@example.com", SMTP_PASS: "secret" }).secure, false);
  assert.throws(() => getSmtpConfig({ SMTP_HOST: "smtp.gmail.com" }), /missing SMTP_USER and SMTP_PASS/);
});

test("SMTP uses Gmail defaults, accepts spaced app passwords, and reports missing keys", () => {
  const config = getSmtpConfig({ SMTP_USER: "shop@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" });
  assert.equal(config.host, "smtp.gmail.com");
  assert.equal(config.pass, "abcdefghijklmnop");
  assert.equal(config.from, "WebMatrix <shop@gmail.com>");
  assert.deepEqual(getSmtpStatus({ SMTP_USER: "shop@gmail.com" }), { configured: false, message: "Password-reset SMTP is missing SMTP_PASS in Render." });
});
