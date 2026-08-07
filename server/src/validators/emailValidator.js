const commonDomainTypos = new Map([
  ["gamil.com", "gmail.com"],
  ["gmial.com", "gmail.com"],
  ["gmail.co", "gmail.com"],
  ["gmail.con", "gmail.com"],
  ["yaho.com", "yahoo.com"],
  ["yahoo.co", "yahoo.com"],
  ["outlok.com", "outlook.com"],
  ["hotmai.com", "hotmail.com"],
]);

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return { valid: false, email, message: "Email address is required" };
  if (email.length > 254) return { valid: false, email, message: "Email address is too long" };

  const at = email.lastIndexOf("@");
  if (at <= 0 || at !== email.indexOf("@")) {
    return { valid: false, email, message: "Enter a valid email address, for example name@gmail.com" };
  }

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const validLocal = local.length <= 64
    && !local.startsWith(".")
    && !local.endsWith(".")
    && !local.includes("..")
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local);
  const labels = domain.split(".");
  const validDomain = domain.length <= 253
    && labels.length >= 2
    && labels.every((label) => label.length > 0
      && label.length <= 63
      && !label.startsWith("-")
      && !label.endsWith("-")
      && /^[a-z0-9-]+$/i.test(label))
    && /^[a-z]{2,24}$/i.test(labels.at(-1));

  if (!validLocal || !validDomain) {
    return { valid: false, email, message: "Enter a valid email address, for example name@gmail.com" };
  }

  const suggestedDomain = commonDomainTypos.get(domain);
  if (suggestedDomain) {
    return { valid: false, email, message: `Did you mean ${local}@${suggestedDomain}?` };
  }
  return { valid: true, email, message: "" };
}
