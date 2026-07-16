import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import path from "node:path";

import type { Message, MessageInput } from "./protocol";

const databasePath =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "messages.db");

const database = new DatabaseSync(databasePath);

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

export function createMessage({ username, body }: MessageInput): Message {
  const row = insertMessage.get(username, body, Date.now());

  return toMessage(row);
}

export function listRecentMessages(limit = 50): Message[] {
  return selectRecentMessages.all(limit).map(toMessage).reverse();
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
