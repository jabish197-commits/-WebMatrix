import test from "node:test";
import assert from "node:assert/strict";
import { getSmtpConfig } from "../src/services/emailService.js";

test("SMTP configuration supports Gmail TLS", () => {
  const config = getSmtpConfig({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "465", SMTP_USER: "shop@gmail.com", SMTP_PASS: "app-password", SMTP_FROM: "WebMatrix <shop@gmail.com>" });
  assert.equal(config.secure, true);
  assert.equal(config.port, 465);
  assert.equal(config.from, "WebMatrix <shop@gmail.com>");
});

test("SMTP configuration supports STARTTLS and rejects missing secrets", () => {
  assert.equal(getSmtpConfig({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USER: "mail@example.com", SMTP_PASS: "secret" }).secure, false);
  assert.throws(() => getSmtpConfig({ SMTP_HOST: "smtp.gmail.com" }), /SMTP is not configured/);
});
