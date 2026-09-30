ALTER TABLE transactions ADD COLUMN purged_at TEXT;
INSERT INTO schema_version VALUES(5);
