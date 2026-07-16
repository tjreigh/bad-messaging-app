CREATE TABLE
    IF NOT EXISTS moderation_actions (
        id INTEGER PRIMARY KEY,
        action TEXT NOT NULL CHECK (action IN ('message:delete')),
        message_id INTEGER NOT NULL,
        message_username TEXT NOT NULL,
        message_body TEXT NOT NULL,
        message_created_at INTEGER NOT NULL,
        moderator TEXT NOT NULL,
        created_at INTEGER NOT NULL
    ) STRICT;

CREATE INDEX
    IF NOT EXISTS idx_moderation_actions_created_at
    ON moderation_actions (created_at DESC);
