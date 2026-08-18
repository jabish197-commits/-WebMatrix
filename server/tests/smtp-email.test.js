import test from "node:test";
import assert from "node:assert/strict";
import { describeSmtpError, getEmailJsConfig, getEmailStatus, getResendConfig, getSmtpConfig, getSmtpStatus } from "../src/services/emailService.js";

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
  assert.equal(config.port, 587);
  assert.equal(config.secure, false);
  assert.equal(config.pass, "abcdefghijklmnop");
  assert.equal(config.from, "WebMatrix <shop@gmail.com>");
  assert.deepEqual(getSmtpStatus({ SMTP_USER: "shop@gmail.com" }), { configured: false, message: "Password-reset SMTP is missing SMTP_PASS in Render." });
});

test("SMTP errors are converted to safe configuration guidance", () => {
  assert.match(describeSmtpError(new Error("SMTP password failed (535): authentication unsuccessful")), /new Google App Password/);
  assert.match(describeSmtpError(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" })), /Render Free blocks outbound SMTP/);
  assert.match(describeSmtpError(new Error("SMTP sender failed (550): From address rejected")), /SMTP_FROM/);
  assert.doesNotMatch(describeSmtpError(new Error("unknown failure")), /unknown failure/);
});

test("HTTPS email is preferred when Resend is configured", () => {
  assert.deepEqual(getResendConfig({ RESEND_API_KEY: "re_test", EMAIL_FROM: "WebMatrix <onboarding@resend.dev>" }), {
    apiKey: "re_test", from: "WebMatrix <onboarding@resend.dev>",
  });
  assert.deepEqual(getEmailStatus({ RESEND_API_KEY: "re_test", EMAIL_FROM: "WebMatrix <onboarding@resend.dev>" }), {
    configured: true, transport: "resend-https", sender: "WebMatrix <onboarding@resend.dev>",
  });
  assert.equal(getEmailStatus({ SMTP_USER: "shop@gmail.com", SMTP_PASS: "secret" }).transport, "smtp");
});

test("EmailJS HTTPS configuration has highest priority", () => {
  const env = {
    EMAILJS_SERVICE_ID: "service_webmatrix",
    EMAILJS_TEMPLATE_ID: "template_password_reset",
    EMAILJS_PUBLIC_KEY: "public_key",
    EMAILJS_PRIVATE_KEY: "private_key",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "WebMatrix <onboarding@resend.dev>",
  };
  assert.deepEqual(getEmailJsConfig(env), {
    serviceId: "service_webmatrix", templateId: "template_password_reset", publicKey: "public_key", privateKey: "private_key",
  });
  assert.deepEqual(getEmailStatus(env), {
    configured: true, transport: "emailjs-https", serviceId: "service_webmatrix", templateId: "template_password_reset",
  });
});
