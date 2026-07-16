import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Message, MessageInput } from "./protocol";

const databasePath =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "messages.db");

mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
runMigrations();

const insertMessage = database.prepare(`
  INSERT INTO messages (username, body, created_at)
  VALUES (?, ?, ?)
  RETURNING id, username, body, created_at AS timestamp
`);

const selectRecentMessages = database.prepare(`
  SELECT id, username, body, created_at AS timestamp
  FROM messages
  ORDER BY id DESC
  LIMIT ?
`);

const selectMessagesBefore = database.prepare(`
  SELECT id, username, body, created_at AS timestamp
  FROM messages
  WHERE id < ?
  ORDER BY id DESC
  LIMIT ?
`);

const selectAdminMessages = database.prepare(`
  SELECT id, username, body, created_at AS timestamp
  FROM messages
  WHERE (
    ? = '' OR
    instr(lower(username), lower(?)) > 0 OR
    instr(lower(body), lower(?)) > 0
  )
  ORDER BY id DESC
  LIMIT ?
`);

const selectAdminMessagesBefore = database.prepare(`
  SELECT id, username, body, created_at AS timestamp
  FROM messages
  WHERE id < ? AND (
    ? = '' OR
    instr(lower(username), lower(?)) > 0 OR
    instr(lower(body), lower(?)) > 0
  )
  ORDER BY id DESC
  LIMIT ?
`);

const selectMessageById = database.prepare(`
  SELECT id, username, body, created_at AS timestamp
  FROM messages
  WHERE id = ?
`);

const deleteMessageById = database.prepare(`
  DELETE FROM messages
  WHERE id = ?
`);

const insertModerationAction = database.prepare(`
  INSERT INTO moderation_actions (
    action,
    message_id,
    message_username,
    message_body,
    message_created_at,
    moderator,
    created_at
  )
  VALUES ('message:delete', ?, ?, ?, ?, ?, ?)
`);

export interface MessagePage {
  messages: Message[];
  nextBefore: number | null;
}

export function createMessage({ username, body }: MessageInput): Message {
  const row = insertMessage.get(username, body, Date.now());

  return toMessage(row);
}

export function listRecentMessages(
  limit = 25,
  before?: number,
): MessagePage {
  const rows = before === undefined
    ? selectRecentMessages.all(limit + 1)
    : selectMessagesBefore.all(before, limit + 1);
  const messages = rows.slice(0, limit).map(toMessage);
  const hasMore = rows.length > limit;

  return {
    messages,
    nextBefore: hasMore ? messages[messages.length - 1].id : null,
  };
}

export function listMessagesForAdmin(
  limit = 50,
  before?: number,
  query = "",
): MessagePage {
  const normalizedQuery = query.trim();
  const rows = before === undefined
    ? selectAdminMessages.all(
        normalizedQuery,
        normalizedQuery,
        normalizedQuery,
        limit + 1,
      )
    : selectAdminMessagesBefore.all(
        before,
        normalizedQuery,
        normalizedQuery,
        normalizedQuery,
        limit + 1,
      );
  const messages = rows.slice(0, limit).map(toMessage);

  return {
    messages,
    nextBefore: rows.length > limit ? messages[messages.length - 1].id : null,
  };
}

export function deleteMessage(id: number, moderator: string): Message | null {
  const row = selectMessageById.get(id);

  if (row === undefined) {
    return null;
  }

  const message = toMessage(row);

  database.exec("BEGIN IMMEDIATE");

  try {
    insertModerationAction.run(
      message.id,
      message.username,
      message.body,
      message.timestamp,
      moderator,
      Date.now(),
    );
    deleteMessageById.run(message.id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return message;
}

function runMigrations(): void {
  const migrationsDirectory = path.join(__dirname, "migrations");
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const migrationFile of migrationFiles) {
    const sql = readFileSync(
      path.join(migrationsDirectory, migrationFile),
      "utf8",
    );
    database.exec(sql);
  }
}

function toMessage(
  row: Record<string, SQLOutputValue> | undefined,
): Message {
  if (
    row === undefined ||
    typeof row.id !== "number" ||
    typeof row.username !== "string" ||
    typeof row.body !== "string" ||
    typeof row.timestamp !== "number"
  ) {
    throw new Error("Database returned an invalid message row");
  }

  return {
    id: row.id,
    username: row.username,
    body: row.body,
    timestamp: row.timestamp,
  };
}
