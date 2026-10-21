CREATE TABLE IF NOT EXISTS users (
  chat_id      INTEGER PRIMARY KEY,
  username     TEXT,
  pro_until    INTEGER,           -- unix seconds, null = free
  threshold_usd INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS follows (
  chat_id    INTEGER NOT NULL,
  wallet     TEXT NOT NULL,       -- lowercase 0x
  label      TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, wallet)
);
CREATE INDEX IF NOT EXISTS idx_follows_wallet ON follows (wallet);
CREATE TABLE IF NOT EXISTS wallets (
  wallet       TEXT PRIMARY KEY,
  snapshot     TEXT,              -- JSON of last positions, null until first check
  last_checked INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  charge_id  TEXT PRIMARY KEY,
  chat_id    INTEGER NOT NULL,
  stars      INTEGER NOT NULL,
  paid_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id   INTEGER NOT NULL,
  wallet    TEXT NOT NULL,
  text      TEXT NOT NULL,
  sent_at   INTEGER NOT NULL,
  amount_usd INTEGER NOT NULL DEFAULT 0
);

-- Channel configuration resolved at seed time (numeric chat id of CHANNEL).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
