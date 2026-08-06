export const sendEmail = async ({ to, subject, html, text }) => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw Object.assign(new Error("Password-reset email is not configured. Add RESEND_API_KEY and EMAIL_FROM in Render."), { status: 503 });
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(data.message || "Reset email could not be sent"), { status: 502 });
  }
  return data;
};
