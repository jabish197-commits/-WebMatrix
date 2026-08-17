import net from "node:net";
import tls from "node:tls";

const EOL = "\r\n";

export function getSmtpConfig(env = process.env) {
  const host = env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const port = Number(env.SMTP_PORT || 465);
  const user = env.SMTP_USER?.trim();
  const rawPass = env.SMTP_PASS?.trim();
  const pass = host === "smtp.gmail.com" ? rawPass?.replace(/\s+/g, "") : rawPass;
  const from = env.SMTP_FROM?.trim() || (user ? `WebMatrix <${user}>` : "");
  const secure = env.SMTP_SECURE === undefined ? port === 465 : env.SMTP_SECURE.trim().toLowerCase() === "true";
  const missing = [!user && "SMTP_USER", !pass && "SMTP_PASS"].filter(Boolean);
  if (missing.length) {
    throw Object.assign(new Error(`Password-reset SMTP is missing ${missing.join(" and ")} in Render.`), { status: 503 });
  }
  if (!from || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error("Password-reset SMTP has an invalid SMTP_PORT or SMTP_FROM value in Render."), { status: 503 });
  }
  return { host, port, user, pass, from, secure };
}

export function getSmtpStatus(env = process.env) {
  try {
    const config = getSmtpConfig(env);
    return { configured: true, host: config.host, port: config.port, secure: config.secure, sender: config.user.replace(/^(.{1,2}).*(@.*)$/, "$1••••$2") };
  } catch (error) {
    return { configured: false, message: error.message };
  }
}

export function describeSmtpError(error) {
  const raw = String(error?.message || error || "");
  const lower = raw.toLowerCase();
  if (/\b(534|535)\b/.test(raw) || lower.includes("authentication unsuccessful") || lower.includes("username and password not accepted")) {
    return "Gmail rejected the SMTP login. Create a new Google App Password, then replace SMTP_PASS in Render and redeploy.";
  }
  if (/\b(550|553)\b/.test(raw) && (lower.includes("sender") || lower.includes("from") || lower.includes("send mail as"))) {
    return "Gmail rejected the sender address. Set SMTP_FROM to WebMatrix <the same Gmail address used in SMTP_USER>.";
  }
  if (lower.includes("timed out") || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(error?.code)) {
    return "WebMatrix could not connect to Gmail SMTP. In Render use SMTP_PORT=587 and SMTP_SECURE=false, then redeploy.";
  }
  if (lower.includes("certificate") || lower.includes("tls") || lower.includes("ssl")) {
    return "The secure connection to Gmail SMTP failed. Check SMTP_HOST, SMTP_PORT, and SMTP_SECURE in Render.";
  }
  if (/\b(550|552|554)\b/.test(raw)) {
    return "Gmail refused this email. Check the recipient address and review the matching SMTP error in Render Logs.";
  }
  return "Gmail could not send the reset email. Check the latest webmatrix-api Render Log for the SMTP error code.";
}

class ResponseReader {
  constructor(socket) {
    this.buffer = ""; this.lines = []; this.responses = []; this.waiters = []; this.failure = null;
    this.socket = socket;
    this.onData = (chunk) => this.push(chunk.toString("utf8"));
    this.onError = (error) => this.fail(error);
    socket.on("data", this.onData);
    socket.on("error", this.onError);
  }
  push(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf(EOL)) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + EOL.length);
      this.lines.push(line);
      if (/^\d{3} /.test(line)) { this.responses.push(this.lines.join(EOL)); this.lines = []; }
    }
    while (this.responses.length && this.waiters.length) this.waiters.shift().resolve(this.responses.shift());
  }
  fail(error) { this.failure = error; while (this.waiters.length) this.waiters.shift().reject(error); }
  read() {
    if (this.responses.length) return Promise.resolve(this.responses.shift());
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  detach() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
  }
}

const connect = (factory, readyEvent = "connect") => new Promise((resolve, reject) => {
  const socket = factory();
  socket.once("error", reject);
  socket.once(readyEvent, () => { socket.removeListener("error", reject); resolve(socket); });
});

async function expect(reader, accepted, action) {
  const response = await reader.read();
  const code = Number(response.slice(0, 3));
  if (!accepted.includes(code)) throw new Error(`SMTP ${action} failed (${code}): ${response.replace(/\r?\n/g, " ")}`);
}

async function command(socket, reader, value, accepted, action) {
  socket.write(`${value}${EOL}`);
  await expect(reader, accepted, action);
}

async function openConnection(config) {
  if (config.secure) {
    const socket = await connect(() => tls.connect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: true }), "secureConnect");
    const reader = new ResponseReader(socket);
    await expect(reader, [220], "connection");
    return { socket, reader };
  }
  const plain = await connect(() => net.connect({ host: config.host, port: config.port }));
  let reader = new ResponseReader(plain);
  await expect(reader, [220], "connection");
  await command(plain, reader, "EHLO webmatrix.local", [250], "EHLO");
  await command(plain, reader, "STARTTLS", [220], "STARTTLS");
  reader.detach();
  const socket = await new Promise((resolve, reject) => {
    const upgraded = tls.connect({ socket: plain, servername: config.host, rejectUnauthorized: true }, () => resolve(upgraded));
    upgraded.once("error", reject);
  });
  reader = new ResponseReader(socket);
  return { socket, reader };
}

const addressOf = (value) => {
  const address = String(value || "").match(/<([^>]+)>/)?.[1] || String(value || "");
  const clean = address.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) throw new Error("SMTP sender or recipient address is invalid");
  return clean;
};
const cleanHeader = (value) => String(value || "").replace(/[\r\n]+/g, " ").trim();
const dotStuff = (value) => String(value || "").replace(/\r?\n/g, EOL).replace(/^\./gm, "..");

function messageBody({ from, to, subject, text, html }) {
  const boundary = `webmatrix-${Date.now().toString(36)}`;
  return [
    `From: ${cleanHeader(from)}`, `To: ${cleanHeader(to)}`, `Subject: ${cleanHeader(subject)}`,
    "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary=\"${boundary}\"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", dotStuff(text), "",
    `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", dotStuff(html), "",
    `--${boundary}--`, "",
  ].join(EOL);
}

export const sendEmail = async ({ to, subject, html, text }) => {
  const config = getSmtpConfig();
  let socket;
  try {
    const connection = await openConnection(config);
    socket = connection.socket;
    const { reader } = connection;
    socket.setTimeout(20000, () => socket.destroy(new Error("SMTP connection timed out")));
    await command(socket, reader, "EHLO webmatrix.local", [250], "EHLO");
    await command(socket, reader, "AUTH LOGIN", [334], "authentication");
    await command(socket, reader, Buffer.from(config.user).toString("base64"), [334], "username");
    await command(socket, reader, Buffer.from(config.pass).toString("base64"), [235], "password");
    await command(socket, reader, `MAIL FROM:<${addressOf(config.from)}>`, [250], "sender");
    await command(socket, reader, `RCPT TO:<${addressOf(to)}>`, [250, 251], "recipient");
    await command(socket, reader, "DATA", [354], "message start");
    socket.write(`${messageBody({ from: config.from, to, subject, text, html })}${EOL}.${EOL}`);
    await expect(reader, [250], "message delivery");
    await command(socket, reader, "QUIT", [221], "quit");
    return { accepted: [to], transport: "smtp" };
  } catch (error) {
    console.error("Password-reset SMTP delivery failed", { code: error?.code || null, message: error?.message || String(error) });
    throw Object.assign(new Error(describeSmtpError(error)), { status: 502 });
  } finally { socket?.end(); }
};
