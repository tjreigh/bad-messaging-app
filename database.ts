import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Message, MessageInput } from "./protocol";
import { runMigrations } from "./migrations";

export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

const databasePath =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "messages.db");

mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath, {
  enableForeignKeyConstraints: true,
});
runMigrations(database, path.join(__dirname, "migrations"));

const insertMessage = database.prepare(`
  INSERT INTO messages (room_id, username, body, created_at)
  VALUES (?, ?, ?, ?)
  RETURNING id, username, body, created_at AS timestamp
`);

const selectRecentMessages = database.prepare(`
  SELECT id, username, body, created_at AS timestamp
  FROM messages
  WHERE room_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

const selectMessagesBefore = database.prepare(`
  SELECT id, username, body, created_at AS timestamp
  FROM messages
  WHERE room_id = ? AND id < ?
  ORDER BY id DESC
  LIMIT ?
`);

const selectAdminMessages = database.prepare(`
  SELECT m.id, m.username, m.body, m.created_at AS timestamp,
         m.room_id AS roomId, r.slug AS roomSlug
  FROM messages m
  JOIN rooms r ON r.id = m.room_id
  WHERE (
    ? = '' OR
    instr(lower(m.username), lower(?)) > 0 OR
    instr(lower(m.body), lower(?)) > 0
  )
  AND (? = 0 OR m.room_id = ?)
  ORDER BY m.id DESC
  LIMIT ?
`);

const selectAdminMessagesBefore = database.prepare(`
  SELECT m.id, m.username, m.body, m.created_at AS timestamp,
         m.room_id AS roomId, r.slug AS roomSlug
  FROM messages m
  JOIN rooms r ON r.id = m.room_id
  WHERE m.id < ? AND (
    ? = '' OR
    instr(lower(m.username), lower(?)) > 0 OR
    instr(lower(m.body), lower(?)) > 0
  )
  AND (? = 0 OR m.room_id = ?)
  ORDER BY m.id DESC
  LIMIT ?
`);

const selectMessageById = database.prepare(`
  SELECT m.id, m.username, m.body, m.created_at AS timestamp,
         m.room_id AS roomId, r.slug AS roomSlug
  FROM messages m
  JOIN rooms r ON r.id = m.room_id
  WHERE m.id = ?
`);

const deleteMessageById = database.prepare(`
  DELETE FROM messages
  WHERE id = ?
`);

const touchRoom = database.prepare(`
  UPDATE rooms
  SET last_activity_at = ?,
      expires_at = CASE WHEN expires_at IS NULL THEN NULL ELSE ? END
  WHERE id = ?
`);

const insertMessageDeleteAction = database.prepare(`
  INSERT INTO moderation_actions (
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
  VALUES ('message:delete', ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertRoom = database.prepare(`
  INSERT INTO rooms (slug, title, created_at, last_activity_at, expires_at)
  VALUES (?, NULL, ?, ?, ?)
  RETURNING id, slug, title, created_at, last_activity_at, expires_at
`);

const selectRoomBySlug = database.prepare(`
  SELECT id, slug, title, created_at, last_activity_at, expires_at
  FROM rooms
  WHERE slug = ?
`);

const selectRoomById = database.prepare(`
  SELECT id, slug, title, created_at, last_activity_at, expires_at
  FROM rooms
  WHERE id = ?
`);

const countActiveRoomsStmt = database.prepare(`
  SELECT COUNT(*) AS n FROM rooms WHERE expires_at IS NOT NULL
`);

const selectExpiredRoomIds = database.prepare(`
  SELECT id FROM rooms WHERE expires_at IS NOT NULL AND expires_at <= ?
`);

const deleteRoomById = database.prepare(`
  DELETE FROM rooms WHERE id = ?
`);

const insertRoomCloseAction = database.prepare(`
  INSERT INTO moderation_actions (
    action,
    room_id,
    room_slug,
    moderator,
    created_at
  )
  VALUES ('room:close', ?, ?, ?, ?)
`);

const selectAdminRooms = database.prepare(`
  SELECT r.id, r.slug, r.title, r.created_at, r.last_activity_at, r.expires_at,
         COUNT(m.id) AS messageCount
  FROM rooms r
  LEFT JOIN messages m ON m.room_id = r.id
  WHERE (
    ? = '' OR
    instr(lower(r.slug), lower(?)) > 0 OR
    instr(lower(r.title), lower(?)) > 0
  )
  GROUP BY r.id
  ORDER BY r.id DESC
  LIMIT ?
`);

const selectAdminRoomsBefore = database.prepare(`
  SELECT r.id, r.slug, r.title, r.created_at, r.last_activity_at, r.expires_at,
         COUNT(m.id) AS messageCount
  FROM rooms r
  LEFT JOIN messages m ON m.room_id = r.id
  WHERE r.id < ? AND (
    ? = '' OR
    instr(lower(r.slug), lower(?)) > 0 OR
    instr(lower(r.title), lower(?)) > 0
  )
  GROUP BY r.id
  ORDER BY r.id DESC
  LIMIT ?
`);

export interface Room {
  id: number;
  slug: string;
  title: string | null;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number | null;
}

export interface RoomAdminView extends Room {
  messageCount: number;
}

export interface AdminMessage extends Message {
  roomId: number;
  roomSlug: string;
}

export interface MessagePage {
  messages: Message[];
  nextBefore: number | null;
}

export interface AdminMessagePage {
  messages: AdminMessage[];
  nextBefore: number | null;
}

export interface RoomPage {
  rooms: RoomAdminView[];
  nextBefore: number | null;
}

export function createMessage(
  { username, body }: MessageInput,
  roomId: number,
): Message {
  const now = Date.now();

  database.exec("BEGIN IMMEDIATE");

  try {
    const row = insertMessage.get(roomId, username, body, now);
    touchRoom.run(now, now + ROOM_TTL_MS, roomId);
    database.exec("COMMIT");
    return toMessage(row);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listRecentMessages(
  roomId: number,
  limit = 25,
  before?: number,
): MessagePage {
  const rows = before === undefined
    ? selectRecentMessages.all(roomId, limit + 1)
    : selectMessagesBefore.all(roomId, before, limit + 1);
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
  roomId?: number,
): AdminMessagePage {
  const normalizedQuery = query.trim();
  const roomFilterFlag = roomId === undefined ? 0 : 1;
  const roomFilterId = roomId ?? 0;
  const rows = before === undefined
    ? selectAdminMessages.all(
        normalizedQuery,
        normalizedQuery,
        normalizedQuery,
        roomFilterFlag,
        roomFilterId,
        limit + 1,
      )
    : selectAdminMessagesBefore.all(
        before,
        normalizedQuery,
        normalizedQuery,
        normalizedQuery,
        roomFilterFlag,
        roomFilterId,
        limit + 1,
      );
  const messages = rows.slice(0, limit).map(toAdminMessage);

  return {
    messages,
    nextBefore: rows.length > limit ? messages[messages.length - 1].id : null,
  };
}

export function deleteMessage(id: number, moderator: string): AdminMessage | null {
  const row = selectMessageById.get(id);

  if (row === undefined) {
    return null;
  }

  const message = toAdminMessage(row);

  database.exec("BEGIN IMMEDIATE");

  try {
    insertMessageDeleteAction.run(
      message.id,
      message.username,
      message.body,
      message.timestamp,
      message.roomId,
      message.roomSlug,
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

export function createRoom(slug: string, now: number): Room {
  const expiresAt = now + ROOM_TTL_MS;
  const row = insertRoom.get(slug, now, now, expiresAt);
  return toRoom(row);
}

export function getRoomBySlug(slug: string): Room | null {
  const row = selectRoomBySlug.get(slug);
  return row === undefined ? null : toRoom(row);
}

export function getRoomById(id: number): Room | null {
  const row = selectRoomById.get(id);
  return row === undefined ? null : toRoom(row);
}

export function countActiveRooms(): number {
  const row = countActiveRoomsStmt.get() as { n: number } | undefined;
  return row === undefined ? 0 : row.n;
}

export function deleteExpiredRooms(now: number): number[] {
  const rows = selectExpiredRoomIds.all(now) as { id: number }[];
  for (const row of rows) {
    deleteRoomById.run(row.id);
  }
  return rows.map((row) => row.id);
}

export function closeRoom(id: number, moderator: string): Room | null {
  const room = getRoomById(id);

  if (room === null || room.expiresAt === null) {
    return null;
  }

  database.exec("BEGIN IMMEDIATE");

  try {
    insertRoomCloseAction.run(room.id, room.slug, moderator, Date.now());
    deleteRoomById.run(room.id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return room;
}

export function listRoomsForAdmin(
  limit = 50,
  before?: number,
  query = "",
): RoomPage {
  const normalizedQuery = query.trim();
  const rows = before === undefined
    ? selectAdminRooms.all(
        normalizedQuery,
        normalizedQuery,
        normalizedQuery,
        limit + 1,
      )
    : selectAdminRoomsBefore.all(
        before,
        normalizedQuery,
        normalizedQuery,
        normalizedQuery,
        limit + 1,
      );
  const rooms = rows.slice(0, limit).map(toRoomAdminView);

  return {
    rooms,
    nextBefore: rows.length > limit ? rooms[rooms.length - 1].id : null,
  };
}

function toMessage(row: Record<string, SQLOutputValue> | undefined): Message {
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

function toAdminMessage(
  row: Record<string, SQLOutputValue> | undefined,
): AdminMessage {
  if (
    row === undefined ||
    typeof row.id !== "number" ||
    typeof row.username !== "string" ||
    typeof row.body !== "string" ||
    typeof row.timestamp !== "number" ||
    typeof row.roomId !== "number" ||
    typeof row.roomSlug !== "string"
  ) {
    throw new Error("Database returned an invalid admin message row");
  }

  return {
    id: row.id,
    username: row.username,
    body: row.body,
    timestamp: row.timestamp,
    roomId: row.roomId,
    roomSlug: row.roomSlug,
  };
}

function toRoom(row: Record<string, SQLOutputValue> | undefined): Room {
  if (
    row === undefined ||
    typeof row.id !== "number" ||
    typeof row.slug !== "string" ||
    (row.title !== null && typeof row.title !== "string") ||
    typeof row.created_at !== "number" ||
    typeof row.last_activity_at !== "number" ||
    (row.expires_at !== null && typeof row.expires_at !== "number")
  ) {
    throw new Error("Database returned an invalid room row");
  }

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    expiresAt: row.expires_at,
  };
}

function toRoomAdminView(
  row: Record<string, SQLOutputValue> | undefined,
): RoomAdminView {
  const room = toRoom(row);

  if (row === undefined || typeof row.messageCount !== "number") {
    throw new Error("Database returned an invalid room admin row");
  }

  return { ...room, messageCount: row.messageCount };
}
