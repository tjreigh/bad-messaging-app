CREATE TABLE rooms (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    expires_at INTEGER
) STRICT;

INSERT INTO rooms (slug, title, created_at, last_activity_at, expires_at)
VALUES ('general', 'general', unixepoch() * 1000, unixepoch() * 1000, NULL);

CREATE TABLE messages_new (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    username TEXT NOT NULL CHECK (length (username) BETWEEN 1 AND 32),
    body TEXT NOT NULL CHECK (length (body) BETWEEN 1 AND 500),
    created_at INTEGER NOT NULL
) STRICT;

INSERT INTO messages_new (id, room_id, username, body, created_at)
SELECT id, (SELECT id FROM rooms WHERE slug = 'general'), username, body, created_at
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX idx_messages_room_id_id ON messages (room_id, id DESC);
