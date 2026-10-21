// Server-rendered HTML. No framework, one stylesheet, works on a phone.
import { CHAINS, PRODUCTS, deliveryUrl, type ChainId, type Product } from "./config.ts";
import type { InvoiceRow } from "./db.ts";
import { unitsToDisplay } from "./money.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
:root{--bg:#fff;--fg:#111;--muted:#666;--line:#e5e5e5;--card:#fafafa;--accent:#111;--ok:#15803d}
@media(prefers-color-scheme:dark){:root{--bg:#0f0f10;--fg:#f2f2f2;--muted:#a1a1aa;--line:#27272a;--card:#18181b;--accent:#f2f2f2;--ok:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;margin:24px 0 8px}
p{margin:8px 0}.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
label{display:block;margin:12px 0 4px}input[type=email]{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font-size:16px}
.choice{display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:8px;margin:6px 0;cursor:pointer}
button,.btn{display:inline-block;background:var(--accent);color:var(--bg);border:0;border-radius:8px;padding:12px 18px;font-size:16px;cursor:pointer;text-decoration:none}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.amount{font-size:28px;font-weight:600}
.addr{word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-size:14px}
.copy{font-size:13px;padding:6px 10px;margin-left:6px}.ok{color:var(--ok);font-weight:600}#qr{background:#fff;padding:12px;border-radius:12px;display:inline-block;margin:8px 0}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}
`;

function layout(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style>${extraHead}</head><body><main>${body}</main></body></html>`;
}

export function catalogPage(): string {
  const items = PRODUCTS.filter((p) => p.active)
    .map(
      (p) => `<div class="card"><h2 style="margin-top:0">${esc(p.name)}</h2><p class="muted">${esc(p.description)}</p>
<p><b>$${p.priceUsd}</b> · USDC on Base or Solana, USDT on TON</p><a class="btn" href="/buy/${esc(p.id)}">Buy</a></div>`,
    )
    .join("");
  return layout("Checkout", `<h1>Checkout</h1><p class="muted">Pay in stablecoins directly to the seller. No account, no card.</p>${items}`);
}

export function buyPage(p: Product, error?: string): string {
  const chains = (Object.values(CHAINS) as Array<(typeof CHAINS)[ChainId]>)
    .map(
      (c, i) =>
        `<label class="choice"><input type="radio" name="chain" value="${c.id}" ${i === 0 ? "checked" : ""}> ${esc(c.label)}</label>`,
    )
    .join("");
  return layout(
    `Buy ${p.name}`,
    `<h1>${esc(p.name)}</h1><p class="muted">${esc(p.description)}</p>
<div class="card"><p class="amount">$${p.priceUsd}</p>
${error ? `<p style="color:#b91c1c">${esc(error)}</p>` : ""}
<form method="post" action="/api/invoice">
<input type="hidden" name="product_id" value="${esc(p.id)}">
<label for="email">Email, used only if we need to contact you about this order</label>
<input id="email" type="email" name="email" required placeholder="you@example.com" autocomplete="email">
<p style="margin-top:14px">Pay with</p>${chains}
<p style="margin-top:14px"><button type="submit">Continue to payment</button></p>
</form></div>
<p class="muted">You will get an exact amount and an address. The payment is detected on-chain within about a minute.</p>`,
  );
}

function payUri(inv: InvoiceRow): string {
  const c = CHAINS[inv.chain];
  const human = unitsToDisplay(inv.amount_units, c.decimals);
  switch (inv.chain) {
    case "solana":
      return `solana:${c.receiver}?amount=${human}&spl-token=${c.tokenAddress}&memo=${inv.id}&label=Checkout`;
    case "ton":
      return `ton://transfer/${c.receiver}?jetton=${c.tokenAddress}&amount=${inv.amount_units}&text=${inv.id}`;
    case "base":
    default:
      // EIP-681 token transfer on chain 8453 (Base). Many wallets ignore it and just read the address, which is fine.
      return `ethereum:${c.tokenAddress}@8453/transfer?address=${c.receiver}&uint256=${inv.amount_units}`;
  }
}

export function payPage(inv: InvoiceRow, product: Product | undefined, publicUrl = ""): string {
  const link = product ? deliveryUrl(publicUrl, product, inv.id) : undefined;
  const c = CHAINS[inv.chain];
  const amount = unitsToDisplay(inv.amount_units, c.decimals);
  const paid = inv.status === "paid";
  const expired = inv.status === "expired";
  const uri = payUri(inv);
  const chainHints: Record<ChainId, string> = {
    base: "Send USDC on the Base network only. Sending on Ethereum, Arbitrum or another network will not be detected automatically.",
    solana: "Send USDC on Solana. If your wallet supports Solana Pay, scanning the QR fills in the amount and memo.",
    ton: "Send USDT (jetton) on TON. Tonkeeper and MyTonWallet open the QR with the amount and comment prefilled. Keep the comment as is.",
  };
  const body = paid
    ? `<h1 class="ok">Paid</h1><p>Thank you. Bookmark this page, it keeps your key. ${inv.email_sent_at ? `A receipt was sent to <b>${esc(inv.email)}</b>.` : ""}</p>
${inv.license_key ? `<div class="card"><p class="muted" style="margin-top:0">Your license key</p><p class="mono amount" style="font-size:20px">${esc(inv.license_key)}</p></div>` : ""}
${link ? `<div class="card"><p class="muted" style="margin-top:0">${product?.delivery.kind === "intake" ? "Next step: tell us about the project" : "Your access link"}</p><p><a class="btn" href="${esc(link)}">${product?.delivery.kind === "intake" ? "Open the intake form" : esc(link)}</a></p></div>` : ""}
<p class="muted">Transaction: <a href="${esc(c.explorerTx(inv.tx_hash ?? ""))}">${esc((inv.tx_hash ?? "").slice(0, 18))}…</a></p>`
    : expired
      ? `<h1>Invoice expired</h1><p>This payment request is no longer valid. <a href="/buy/${esc(inv.product_id)}">Start a new one</a>. If you already sent the payment, reply to the receipt address with your transaction hash.</p>`
      : `<h1>${esc(product?.name ?? inv.product_id)}</h1>
<div class="card">
<p class="muted" style="margin-top:0">Send exactly</p>
<p class="amount"><span id="amt">${amount}</span> ${c.token} <button class="copy" data-copy="${amount}">copy</button></p>
<p class="muted">${esc(c.label)} · the cents make this payment yours, do not round</p>
<p class="muted" style="margin-top:14px">To this address</p>
<p class="addr mono" id="addr">${esc(c.receiver)}</p>
<p><button class="copy" data-copy="${esc(c.receiver)}">copy address</button> <a class="btn copy" href="${esc(uri)}">open in wallet</a></p>
<div id="qr"></div>
<p class="muted">${chainHints[inv.chain]}</p>
<p id="status" class="muted">Waiting for payment… this page updates itself. Request valid for <span id="ttl"></span>.</p>
</div>
<p class="muted">Invoice ${esc(inv.id)} · receipt to ${esc(inv.email)}</p>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
new QRCode(document.getElementById('qr'),{text:${JSON.stringify(uri)},width:200,height:200,correctLevel:QRCode.CorrectLevel.M});
document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>{navigator.clipboard.writeText(b.dataset.copy).then(()=>{const t=b.textContent;b.textContent='copied';setTimeout(()=>b.textContent=t,1200)})}));
const exp=${inv.expires_at}*1000;function tick(){const s=Math.max(0,Math.floor((exp-Date.now())/1000));document.getElementById('ttl').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}tick();setInterval(tick,1000);
async function poll(){try{const r=await fetch('/api/invoice/${esc(inv.id)}');const j=await r.json();if(j.status==='paid'){location.reload()}if(j.status==='expired'){document.getElementById('status').textContent='Expired. Reload to start again.'}}catch(e){}}setInterval(poll,5000);
</script>`;
  return layout(paid ? "Paid" : "Pay", body);
}

export function adminPage(rows: InvoiceRow[], unmatched: Array<{ chain: string; tx_hash: string; from_addr: string | null; amount_units: number; memo: string | null; seen_at: number }>, report: Record<string, string> | null, adminToken = ""): string {
  const fmt = (t: number | null) => (t ? new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) : "");
  const inv = rows
    .map(
      (r) =>
        `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.product_id)}</td><td>${esc(r.email)}</td><td>${r.chain}</td><td>${unitsToDisplay(r.amount_units)}</td><td>${r.status}${r.status === "pending" ? ` <form method="post" action="/admin/simulate?token=${encodeURIComponent(adminToken)}&invoice=${esc(r.id)}" style="display:inline"><button class="copy" title="Mark paid without a transfer (test)">simulate</button></form>` : ""}</td><td>${fmt(r.created_at)}</td><td>${fmt(r.paid_at)}</td><td class="mono">${r.tx_hash ? `<a href="${esc(CHAINS[r.chain].explorerTx(r.tx_hash))}">tx</a>` : ""}</td><td>${r.email_sent_at ? "sent" : esc(r.email_error ?? "")}</td></tr>`,
    )
    .join("");
  const um = unmatched
    .map((t) => `<tr><td>${t.chain}</td><td class="mono">${esc(t.tx_hash.slice(0, 14))}…</td><td class="mono">${esc((t.from_addr ?? "").slice(0, 14))}</td><td>${unitsToDisplay(t.amount_units)}</td><td>${esc(t.memo ?? "")}</td><td>${fmt(t.seen_at)}</td></tr>`)
    .join("");
  return layout(
    "Admin",
    `<h1>Invoices</h1>${report ? `<div class="card"><pre class="mono" style="margin:0;white-space:pre-wrap">${esc(JSON.stringify(report, null, 2))}</pre></div>` : ""}
<p><a class="btn copy" href="?run=1">Run watchers now</a></p>
<table><tr><th>id</th><th>product</th><th>email</th><th>chain</th><th>amount</th><th>status</th><th>created</th><th>paid</th><th>tx</th><th>email</th></tr>${inv}</table>
<h2>Unmatched transfers</h2><p class="muted">Money that arrived without a matching invoice: wrong amount, late, or a tip. Settle manually if needed.</p>
<table><tr><th>chain</th><th>tx</th><th>from</th><th>amount</th><th>memo</th><th>seen</th></tr>${um}</table>`,
  );
}

export function intakePage(p: Product, invoiceId: string, done = false, error?: string): string {
  if (p.delivery.kind !== "intake") return layout("Not found", "<h1>Not found</h1>");
  if (done) return layout("Received", `<h1 class="ok">Received</h1><p>Thanks. You will get a reply by email within one business day.</p>`);
  const fields = p.delivery.fields
    .map((q, i) => `<label for="q${i}">${esc(q)}</label><textarea id="q${i}" name="q${i}" rows="3" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit"></textarea>`)
    .join("");
  return layout(
    `Intake: ${p.name}`,
    `<h1>${esc(p.name)}</h1><p class="muted">A few questions so the work can start right away.</p>
<div class="card">${error ? `<p style="color:#b91c1c">${esc(error)}</p>` : ""}
<form method="post" action="/api/intake"><input type="hidden" name="product_id" value="${esc(p.id)}"><input type="hidden" name="invoice_id" value="${esc(invoiceId)}">
<label for="email">Your email</label><input id="email" type="email" name="email" required>
${fields}
<p style="margin-top:14px"><button type="submit">Send</button></p></form></div>`,
  );
}

export function intakesTable(rows: Array<{ id: number; product_id: string; invoice_id: string | null; email: string; answers: string; created_at: number }>): string {
  return rows
    .map((r) => {
      const a = JSON.parse(r.answers) as Record<string, string>;
      return `<div class="card"><p style="margin-top:0"><b>${esc(r.product_id)}</b> · ${esc(r.email)} · ${new Date(r.created_at * 1000).toISOString().slice(0, 16).replace("T", " ")}${r.invoice_id ? ` · invoice <span class="mono">${esc(r.invoice_id)}</span>` : ""}</p>${Object.entries(a)
        .map(([q, v]) => `<p class="muted" style="margin:4px 0 0">${esc(q)}</p><p style="margin:0 0 6px;white-space:pre-wrap">${esc(v)}</p>`)
        .join("")}</div>`;
    })
    .join("");
}
