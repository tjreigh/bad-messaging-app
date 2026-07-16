CREATE TABLE moderation_actions_new (
    id INTEGER PRIMARY KEY,
    action TEXT NOT NULL CHECK (action IN ('message:delete', 'room:close')),
    message_id INTEGER,
    message_username TEXT,
    message_body TEXT,
    message_created_at INTEGER,
    room_id INTEGER,
    room_slug TEXT,
    moderator TEXT NOT NULL,
    created_at INTEGER NOT NULL
) STRICT;

INSERT INTO moderation_actions_new (
    id,
    action,
    message_id,
    message_username,
    message_body,
    message_created_at,
    room_id,
    room_slug,
    moderator,
    created_at
)
SELECT
    id,
    action,
    message_id,
    message_username,
    message_body,
    message_created_at,
    NULL,
    NULL,
    moderator,
    created_at
FROM moderation_actions;

DROP TABLE moderation_actions;
ALTER TABLE moderation_actions_new RENAME TO moderation_actions;

CREATE INDEX idx_moderation_actions_created_at
    ON moderation_actions (created_at DESC);
