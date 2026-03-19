CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    language_code TEXT NOT NULL DEFAULT 'en',
    is_admin      BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_text   TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    source_lang     TEXT NOT NULL,
    target_lang     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_sender_recipient_idx
    ON messages (sender_id, recipient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS calls (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    callee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ
);

-- admin_audit_log records every mutating admin action.
-- Rows are append-only and must never be deleted. They provide an immutable
-- trail for forensics if an admin account is compromised or acts maliciously.
-- target_id may be NULL for actions that don't target a specific user.
-- ip_address is stored for correlation with access logs.
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action       TEXT NOT NULL,   -- e.g. 'delete_user', 'toggle_admin', 'view_messages'
    target_id    UUID,            -- the affected user's ID, if applicable
    detail       TEXT,            -- optional freeform context
    ip_address   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_idx  ON admin_audit_log (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON admin_audit_log (target_id, created_at DESC);
