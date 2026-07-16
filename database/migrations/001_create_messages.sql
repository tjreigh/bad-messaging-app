CREATE TABLE
    IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL CHECK (length (username) BETWEEN 1 AND 32),
        body TEXT NOT NULL CHECK (length (body) BETWEEN 1 AND 500),
        created_at INTEGER NOT NULL
    ) STRICT;
