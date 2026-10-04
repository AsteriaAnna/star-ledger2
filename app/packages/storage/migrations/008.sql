ALTER TABLE transactions ADD COLUMN user_edits TEXT;
INSERT INTO schema_version VALUES(8);
