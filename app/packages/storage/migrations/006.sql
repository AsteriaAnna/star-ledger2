ALTER TABLE transaction_links ADD COLUMN deleted_at TEXT;
INSERT INTO schema_version VALUES(6);
