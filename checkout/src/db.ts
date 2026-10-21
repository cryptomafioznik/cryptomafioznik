import type { ChainId } from "./config.ts";

export interface InvoiceRow {
  id: string;
  product_id: string;
  email: string;
  chain: ChainId;
  price_units: number;
  amount_units: number;
  status: "pending" | "paid" | "expired";
  created_at: number;
  expires_at: number;
  paid_at: number | null;
  tx_hash: string | null;
  tx_from: string | null;
  license_key: string | null;
  email_sent_at: number | null;
  email_error: string | null;
}

export interface IncomingTransfer {
  chain: ChainId;
  txHash: string;
  logIndex: number;
  from: string | null;
  amountUnits: number;
  memo: string | null;
}

export const now = () => Math.floor(Date.now() / 1000);

export async function getCursor(db: D1Database, chain: ChainId): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM cursors WHERE chain = ?").bind(chain).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setCursor(db: D1Database, chain: ChainId, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO cursors (chain, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(chain) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(chain, value, now())
    .run();
}

/** Amounts that must not be reused on this chain: every invoice still pending (TTL or grace period). */
export async function takenAmounts(db: D1Database, chain: ChainId): Promise<Set<number>> {
  const { results } = await db
    .prepare("SELECT amount_units FROM invoices WHERE chain = ? AND status = 'pending'")
    .bind(chain)
    .all<{ amount_units: number }>();
  return new Set(results.map((r) => r.amount_units));
}

export async function insertInvoice(db: D1Database, inv: Omit<InvoiceRow, "paid_at" | "tx_hash" | "tx_from" | "license_key" | "email_sent_at" | "email_error">): Promise<void> {
  await db
    .prepare(
      "INSERT INTO invoices (id, product_id, email, chain, price_units, amount_units, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(inv.id, inv.product_id, inv.email, inv.chain, inv.price_units, inv.amount_units, inv.status, inv.created_at, inv.expires_at)
    .run();
}

export async function getInvoice(db: D1Database, id: string): Promise<InvoiceRow | null> {
  return (await db.prepare("SELECT * FROM invoices WHERE id = ?").bind(id).first<InvoiceRow>()) ?? null;
}

/** Record a transfer. Returns false if it was already recorded (duplicate scan). */
export async function recordTransfer(db: D1Database, t: IncomingTransfer): Promise<boolean> {
  const res = await db
    .prepare("INSERT OR IGNORE INTO transfers (chain, tx_hash, log_index, from_addr, amount_units, memo, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(t.chain, t.txHash, t.logIndex, t.from, t.amountUnits, t.memo, now())
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Oldest pending invoice on this chain with exactly this amount, or one named in the memo with amount >= price. */
export async function findMatchingInvoice(db: D1Database, t: IncomingTransfer, graceSeconds: number): Promise<InvoiceRow | null> {
  const cutoff = now() - graceSeconds;
  if (t.memo) {
    const byMemo = await db
      .prepare("SELECT * FROM invoices WHERE id = ? AND chain = ? AND status = 'pending' AND expires_at >= ? AND ? >= price_units")
      .bind(t.memo.trim().toLowerCase(), t.chain, cutoff, t.amountUnits)
      .first<InvoiceRow>();
    if (byMemo) return byMemo;
  }
  const byAmount = await db
    .prepare("SELECT * FROM invoices WHERE chain = ? AND status = 'pending' AND amount_units = ? AND expires_at >= ? ORDER BY created_at ASC LIMIT 1")
    .bind(t.chain, t.amountUnits, cutoff)
    .first<InvoiceRow>();
  return byAmount ?? null;
}

export async function markPaid(db: D1Database, id: string, t: IncomingTransfer, licenseKey: string | null): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE invoices SET status = 'paid', paid_at = ?, tx_hash = ?, tx_from = ?, license_key = ? WHERE id = ? AND status = 'pending'")
      .bind(now(), t.txHash, t.from, licenseKey, id),
    db.prepare("UPDATE transfers SET invoice_id = ? WHERE chain = ? AND tx_hash = ? AND log_index = ?").bind(id, t.chain, t.txHash, t.logIndex),
  ]);
}

export async function insertLicense(db: D1Database, key: string, productId: string, invoiceId: string, email: string, expiresAt: number | null): Promise<void> {
  await db
    .prepare("INSERT INTO licenses (key, product_id, invoice_id, email, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(key, productId, invoiceId, email, now(), expiresAt)
    .run();
}

export async function getLicense(db: D1Database, key: string) {
  return db
    .prepare("SELECT key, product_id, invoice_id, issued_at, expires_at, revoked_at FROM licenses WHERE key = ?")
    .bind(key)
    .first<{ key: string; product_id: string; invoice_id: string; issued_at: number; expires_at: number | null; revoked_at: number | null }>();
}

export async function setEmailResult(db: D1Database, id: string, error: string | null): Promise<void> {
  await db.prepare("UPDATE invoices SET email_sent_at = ?, email_error = ? WHERE id = ?").bind(error ? null : now(), error, id).run();
}

/** Flip invoices past TTL + grace to expired so their amounts become reusable. */
export async function expireOld(db: D1Database, graceSeconds: number): Promise<void> {
  await db.prepare("UPDATE invoices SET status = 'expired' WHERE status = 'pending' AND expires_at < ?").bind(now() - graceSeconds).run();
}

export async function listInvoices(db: D1Database, limit = 200): Promise<InvoiceRow[]> {
  const { results } = await db.prepare("SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?").bind(limit).all<InvoiceRow>();
  return results;
}

/** Paid invoices whose email failed or was never sent: retried by the cron. */
export async function unsentReceipts(db: D1Database): Promise<InvoiceRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM invoices WHERE status = 'paid' AND email_sent_at IS NULL AND paid_at > ? LIMIT 20")
    .bind(now() - 7 * 86400)
    .all<InvoiceRow>();
  return results;
}
