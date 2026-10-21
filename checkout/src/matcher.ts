// Runs on the cron: scans every chain, records transfers, pays invoices, sends receipts.
import { CHAINS, LATE_PAYMENT_GRACE_SECONDS, getProduct, type ChainId } from "./config.ts";
import {
  expireOld,
  findMatchingInvoice,
  getCursor,
  insertLicense,
  markPaid,
  recordTransfer,
  setCursor,
  setEmailResult,
  unsentReceipts,
  type IncomingTransfer,
  type InvoiceRow,
} from "./db.ts";
import { renderReceipt, sendEmail, type EmailEnv } from "./email.ts";
import { makeLicenseKey } from "./license.ts";
import { unitsToDisplay } from "./money.ts";
import { scanBase } from "./watchers/base.ts";
import { scanSolana } from "./watchers/solana.ts";
import { scanTon } from "./watchers/ton.ts";

export interface Env extends EmailEnv {
  DB: D1Database;
  LICENSE_SECRET: string;
  ADMIN_TOKEN?: string;
  BASE_RPC_URL: string;
  SOLANA_RPC_URL: string;
  TONCENTER_API_KEY: string;
}

export async function settle(env: Env, invoice: InvoiceRow, t: IncomingTransfer): Promise<void> {
  const product = getProduct(invoice.product_id);
  let licenseKey: string | null = null;
  if (product?.delivery.kind === "license") {
    licenseKey = await makeLicenseKey(env.LICENSE_SECRET, invoice.product_id, invoice.id);
  }
  await markPaid(env.DB, invoice.id, t, licenseKey);
  if (licenseKey && product?.delivery.kind === "license") {
    const expiresAt = product.delivery.days ? Math.floor(Date.now() / 1000) + product.delivery.days * 86400 : null;
    await insertLicense(env.DB, licenseKey, invoice.product_id, invoice.id, invoice.email, expiresAt);
  }
  await deliverReceipt(env, { ...invoice, status: "paid", tx_hash: t.txHash, license_key: licenseKey });
}

export async function deliverReceipt(env: Env, invoice: InvoiceRow): Promise<void> {
  const product = getProduct(invoice.product_id);
  if (!product) {
    await setEmailResult(env.DB, invoice.id, `unknown product ${invoice.product_id}`);
    return;
  }
  const chain = CHAINS[invoice.chain];
  const msg = renderReceipt({
    invoiceId: invoice.id,
    product,
    email: invoice.email,
    chainLabel: chain.label,
    amountDisplay: `${unitsToDisplay(invoice.amount_units, chain.decimals)} ${chain.token}`,
    txUrl: invoice.tx_hash ? chain.explorerTx(invoice.tx_hash) : "",
    statusUrl: `${env.PUBLIC_URL}/pay/${invoice.id}`,
    licenseKey: invoice.license_key ?? undefined,
    link: product.delivery.kind === "link" ? product.delivery.url : undefined,
  });
  const err = await sendEmail(env, invoice.email, msg);
  await setEmailResult(env.DB, invoice.id, err);
}

async function processTransfers(env: Env, transfers: IncomingTransfer[]): Promise<number> {
  let paid = 0;
  for (const t of transfers) {
    const isNew = await recordTransfer(env.DB, t);
    if (!isNew) continue;
    const inv = await findMatchingInvoice(env.DB, t, LATE_PAYMENT_GRACE_SECONDS);
    if (!inv) continue; // unmatched transfer stays in `transfers` for manual review in /admin
    await settle(env, inv, t);
    paid++;
  }
  return paid;
}

export async function runWatchers(env: Env): Promise<Record<string, string>> {
  const report: Record<string, string> = {};
  await expireOld(env.DB, LATE_PAYMENT_GRACE_SECONDS);

  const jobs: Array<[ChainId, () => Promise<{ transfers: IncomingTransfer[]; cursor: string | null }>]> = [
    ["base", async () => scanBase(env.BASE_RPC_URL, await getCursor(env.DB, "base"))],
    ["solana", async () => scanSolana(env.SOLANA_RPC_URL, await getCursor(env.DB, "solana"))],
    ["ton", async () => scanTon(env.TONCENTER_API_KEY, await getCursor(env.DB, "ton"))],
  ];
  for (const [chain, job] of jobs) {
    try {
      const { transfers, cursor } = await job();
      const paid = await processTransfers(env, transfers);
      if (cursor !== null) await setCursor(env.DB, chain, cursor);
      report[chain] = `ok: ${transfers.length} transfers, ${paid} paid, cursor ${cursor}`;
    } catch (e) {
      // One chain failing must not stop the others. Cursor is untouched, so the range is rescanned next minute.
      report[chain] = `error: ${(e as Error).message}`;
    }
  }

  // Retry receipts that failed to send (Resend outage). Without a key, email is simply off: the license
  // lives on the /pay/<id> page, which the buyer can reopen at any time.
  if (env.RESEND_API_KEY) {
    for (const inv of await unsentReceipts(env.DB)) {
      await deliverReceipt(env, inv);
    }
  }
  return report;
}
