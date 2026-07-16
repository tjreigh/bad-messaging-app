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

const selectMessagesBefore = database.prepare(`
  SELECT id, username, body, created_at AS timestamp
  FROM messages
  WHERE id < ?
  ORDER BY id DESC
  LIMIT ?
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
