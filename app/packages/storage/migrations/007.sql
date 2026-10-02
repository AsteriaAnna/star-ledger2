CREATE TABLE balance_anchors(
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 observed_balance INTEGER NOT NULL,
 observed_at TEXT NOT NULL,
 source_type TEXT NOT NULL,
 created_at TEXT NOT NULL,
 deleted_at TEXT
);
CREATE INDEX anchors_by_account_time ON balance_anchors(account_id,observed_at);
INSERT INTO schema_version VALUES(7);
