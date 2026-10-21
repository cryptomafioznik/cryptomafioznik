-- Invoices: one row per purchase attempt.
CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,            -- short public id, used in URLs and TON comments
  product_id    TEXT NOT NULL,
  email         TEXT NOT NULL,
  chain         TEXT NOT NULL,               -- 'base' | 'solana' | 'ton'
  price_units   INTEGER NOT NULL,            -- product price in token minor units (6 decimals)
  amount_units  INTEGER NOT NULL,            -- price + unique cents offset, what the buyer must send
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | paid | expired
  created_at    INTEGER NOT NULL,            -- unix seconds
  expires_at    INTEGER NOT NULL,            -- unix seconds; after this, amount can be reused
  paid_at       INTEGER,
  tx_hash       TEXT,
  tx_from       TEXT,
  license_key   TEXT,
  email_sent_at INTEGER,
  email_error   TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_pending ON invoices (chain, status, amount_units);
CREATE INDEX IF NOT EXISTS idx_invoices_email ON invoices (email);

-- Every incoming transfer we have seen, paid or not. Prevents double-processing and keeps an audit trail.
CREATE TABLE IF NOT EXISTS transfers (
  chain        TEXT NOT NULL,
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL DEFAULT 0,
  from_addr    TEXT,
  amount_units INTEGER NOT NULL,
  memo         TEXT,
  seen_at      INTEGER NOT NULL,
  invoice_id   TEXT,                         -- null if no invoice matched
  PRIMARY KEY (chain, tx_hash, log_index)
);

-- Scan cursor per chain: last block / signature / lt processed.
CREATE TABLE IF NOT EXISTS cursors (
  chain  TEXT PRIMARY KEY,
  value  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Issued licenses, for verification and revocation.
CREATE TABLE IF NOT EXISTS licenses (
  key         TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL,
  invoice_id  TEXT NOT NULL,
  email       TEXT NOT NULL,
  issued_at   INTEGER NOT NULL,
  expires_at  INTEGER,                       -- null = lifetime
  revoked_at  INTEGER
);
