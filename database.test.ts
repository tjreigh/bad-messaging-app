import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(mkdtempSync(join(tmpdir(), "bma-db-")), "test.db");
process.env.DATABASE_PATH = databasePath;

const database = require("./database") as typeof import("./database");
const {
  createMessage,
  createRoom,
  listRecentMessages,
  deleteExpiredRooms,
  closeRoom,
  getRoomBySlug,
  getRoomById,
} = database;

let slugCounter = 0;

const nextSlug = () => {
  slugCounter += 1;
  return `t${String(slugCounter).padStart(7, "0")}`;
};

test("the general room is seeded as permanent", () => {
  const general = getRoomBySlug("general");
  assert.ok(general !== null);
  assert.equal(general!.expiresAt, null);
});

test("messages never cross rooms", () => {
  const roomA = createRoom(nextSlug(), Date.now());
  const roomB = createRoom(nextSlug(), Date.now());

  createMessage({ username: "Alice", body: "in A" }, roomA.id);
  createMessage({ username: "Bob", body: "in B" }, roomB.id);
  createMessage({ username: "Alice", body: "also A" }, roomA.id);

  const aPage = listRecentMessages(roomA.id, 25);
  const bPage = listRecentMessages(roomB.id, 25);

  assert.equal(aPage.messages.length, 2);
  assert.ok(aPage.messages.every((m) => m.body.endsWith("A")));
  assert.equal(bPage.messages.length, 1);
  assert.equal(bPage.messages[0].body, "in B");
});

test("pagination stays room-scoped across cursor pages", () => {
  const room = createRoom(nextSlug(), Date.now());

  for (let i = 0; i < 6; i++) {
    createMessage({ username: "Pager", body: `msg ${i}` }, room.id);
  }

  const first = listRecentMessages(room.id, 2);
  assert.equal(first.messages.length, 2);
  assert.notEqual(first.nextBefore, null);

  const second = listRecentMessages(room.id, 2, first.nextBefore!);
  assert.equal(second.messages.length, 2);
  assert.notEqual(second.nextBefore, null);

  const third = listRecentMessages(room.id, 2, second.nextBefore!);
  assert.equal(third.messages.length, 2);
  assert.equal(third.nextBefore, null);

  const allIds = [...first.messages, ...second.messages, ...third.messages].map(
    (m) => m.id,
  );
  assert.equal(new Set(allIds).size, 6);
});

test("createMessage bumps activity and keeps the general room permanent", () => {
  const general = getRoomBySlug("general");
  assert.ok(general !== null);

  const before = general!.lastActivityAt;
  createMessage({ username: "Time", body: "bump" }, general!.id);

  const after = getRoomBySlug("general");
  assert.ok(after !== null);
  assert.equal(after!.expiresAt, null);
  assert.ok(after!.lastActivityAt >= before);
});

test("createMessage extends a temporary room's expiry", () => {
  const baseNow = Date.now();
  const room = createRoom(nextSlug(), baseNow);
  assert.ok(room.expiresAt !== null);

  createMessage({ username: "Late", body: "hello" }, room.id);

  const refreshed = getRoomById(room.id);
  assert.ok(refreshed !== null);
  assert.ok(refreshed!.expiresAt !== null);
  assert.ok(refreshed!.expiresAt! >= room.expiresAt!);
  assert.ok(refreshed!.lastActivityAt >= baseNow);
});

test("deleteExpiredRooms deletes expired rooms and cascades their messages", () => {
  const room = createRoom(nextSlug(), Date.now());
  createMessage({ username: "Doomed", body: "bye" }, room.id);

  const conn = new DatabaseSync(databasePath);
  conn.prepare("UPDATE rooms SET expires_at = 1 WHERE id = ?").run(room.id);
  conn.close();

  const deletedIds = deleteExpiredRooms(Date.now());
  assert.ok(deletedIds.includes(room.id));
  assert.equal(getRoomById(room.id), null);
  assert.equal(listRecentMessages(room.id, 25).messages.length, 0);

  const general = getRoomBySlug("general");
  assert.ok(general !== null);
});

test("closeRoom records a moderation action and refuses the permanent room", () => {
  const general = getRoomBySlug("general");
  assert.ok(general !== null);
  assert.equal(closeRoom(general!.id, "admin"), null);

  const room = createRoom(nextSlug(), Date.now());
  const closed = closeRoom(room.id, "admin");
  assert.ok(closed !== null);
  assert.equal(closed!.slug, room.slug);
  assert.equal(getRoomById(room.id), null);

  const conn = new DatabaseSync(databasePath);
  const row = conn
    .prepare(
      "SELECT action, room_slug, moderator FROM moderation_actions WHERE room_slug = ?",
    )
    .get(room.slug) as
    | { action: string; room_slug: string; moderator: string }
    | undefined;
  conn.close();

  assert.ok(row !== undefined);
  assert.equal(row.action, "room:close");
  assert.equal(row.room_slug, room.slug);
  assert.equal(row.moderator, "admin");
});

test("createRoom throws on a duplicate slug", () => {
  const slug = nextSlug();
  createRoom(slug, Date.now());
  assert.throws(() => createRoom(slug, Date.now()));
});

test("generateRoomSlug produces valid distinct slugs", () => {
  const { generateRoomSlug, isValidRoomSlug } = require("./slug") as typeof import("./slug");
  const a = generateRoomSlug();
  const b = generateRoomSlug();
  assert.equal(isValidRoomSlug(a), true);
  assert.equal(isValidRoomSlug(b), true);
  assert.notEqual(a, b);
});
