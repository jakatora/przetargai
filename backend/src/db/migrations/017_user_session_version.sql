-- Existing sessions remain valid at version 0 until the account changes password.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0
  CHECK (session_version >= 0);
