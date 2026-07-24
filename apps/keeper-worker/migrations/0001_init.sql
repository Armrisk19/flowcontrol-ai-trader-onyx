CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO system_state(key,value,updated_at) VALUES('execution_paused','true',datetime('now'));

CREATE TABLE IF NOT EXISTS scan_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_pair_index INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO scan_state(id,last_pair_index,updated_at) VALUES(1,0,datetime('now'));

CREATE TABLE IF NOT EXISTS markets (
  pair_address TEXT PRIMARY KEY,
  token0 TEXT NOT NULL,
  token1 TEXT NOT NULL,
  symbol0 TEXT NOT NULL,
  symbol1 TEXT NOT NULL,
  decimals0 INTEGER NOT NULL DEFAULT 18,
  decimals1 INTEGER NOT NULL DEFAULT 18,
  status TEXT NOT NULL DEFAULT 'WATCHLIST',
  discovered_at TEXT NOT NULL,
  observed_since TEXT NOT NULL,
  liquidity_usd REAL NOT NULL DEFAULT 0,
  safe_trade_usd REAL NOT NULL DEFAULT 0,
  round_trip_cost_bps REAL NOT NULL DEFAULT 99999,
  asset_usdc_price REAL NOT NULL DEFAULT 0,
  last_block INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  last_assessed_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
  reviewed INTEGER NOT NULL DEFAULT 0,
  registry_approved INTEGER NOT NULL DEFAULT 0,
  official INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS price_samples (
  pair_address TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  price REAL NOT NULL,
  liquidity_usd REAL NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(pair_address,block_number)
);

CREATE TABLE IF NOT EXISTS vaults (
  vault TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  strategy_id INTEGER NOT NULL,
  referrer TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  issued_at INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vault TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  action TEXT NOT NULL,
  token_in TEXT,
  token_out TEXT,
  amount_in TEXT,
  minimum_out TEXT,
  score REAL,
  reason TEXT NOT NULL,
  tx_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leases (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_tokens ON markets(token0,token1);
CREATE INDEX IF NOT EXISTS idx_vaults_enabled ON vaults(enabled);
CREATE INDEX IF NOT EXISTS idx_decisions_vault ON decisions(vault,created_at);

CREATE TABLE IF NOT EXISTS strategy_metadata (
  id TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  metadata_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strategy_metadata_creator ON strategy_metadata(creator,created_at);


CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  count INTEGER NOT NULL
);
