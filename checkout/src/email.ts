import type { Product } from "./config.ts";

export interface EmailEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM: string;
  PUBLIC_URL: string;
}

export interface Receipt {
  invoiceId: string;
  product: Product;
  email: string;
  chainLabel: string;
  amountDisplay: string;
  txUrl: string;
  statusUrl: string;
  licenseKey?: string;
  link?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderReceipt(r: Receipt): { subject: string; text: string; html: string } {
  const subject = `Your purchase: ${r.product.name}`;
  const lines = [
    `Thanks for your purchase.`,
    ``,
    `Product: ${r.product.name}`,
    `Paid: ${r.amountDisplay} (${r.chainLabel})`,
    `Transaction: ${r.txUrl}`,
    ``,
  ];
  if (r.licenseKey) lines.push(`Your license key:`, ``, `    ${r.licenseKey}`, ``);
  if (r.link) lines.push(`Your access link:`, ``, `    ${r.link}`, ``);
  lines.push(`Status page: ${r.statusUrl}`, `Invoice: ${r.invoiceId}`, ``, `If anything is wrong, reply to this email.`);
  const text = lines.join("\n");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">
<p>Thanks for your purchase.</p>
<p><b>Product:</b> ${esc(r.product.name)}<br>
<b>Paid:</b> ${esc(r.amountDisplay)} (${esc(r.chainLabel)})<br>
<b>Transaction:</b> <a href="${esc(r.txUrl)}">${esc(r.txUrl)}</a></p>
${r.licenseKey ? `<p>Your license key:</p><pre style="font-size:18px;background:#f4f4f5;padding:12px;border-radius:8px">${esc(r.licenseKey)}</pre>` : ""}
${r.link ? `<p>Your access link: <a href="${esc(r.link)}">${esc(r.link)}</a></p>` : ""}
<p style="color:#666">Status page: <a href="${esc(r.statusUrl)}">${esc(r.statusUrl)}</a><br>Invoice ${esc(r.invoiceId)}. If anything is wrong, reply to this email.</p>
</body></html>`;
  return { subject, text, html };
}

/** Sends via Resend. Returns null on success or an error string. Never throws. */
export async function sendEmail(
  env: EmailEnv,
  to: string,
  msg: { subject: string; text: string; html: string },
): Promise<string | null> {
  if (!env.RESEND_API_KEY) return "RESEND_API_KEY not set";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) return `resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
    return null;
  } catch (e) {
    return `resend fetch failed: ${(e as Error).message}`;
  }
}
