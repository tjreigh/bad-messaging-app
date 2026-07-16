import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { hashAdminPassword } from "../src/admin-auth";

const databasePath = join(mkdtempSync(join(tmpdir(), "bma-rooms-")), "test.db");
process.env.DATABASE_PATH = databasePath;

const { startServer } = require("../src/server") as typeof import("../src/server");
const { getRoomBySlug } = require("../src/database") as typeof import("../src/database");

const adminPassword = "integration-test-password";
let server: ReturnType<typeof startServer>;
let baseUrl = "";
let xffCounter = 0;

const nextXff = () => {
  xffCounter += 1;
  return `203.0.113.${xffCounter}`;
};

const createRoomViaApi = async (xff = nextXff()) => {
  const res = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "X-Forwarded-For": xff,
    },
    body: "{}",
  });
  const body = await res.json().catch(() => null);
  return { res, body };
};

const loginAdmin = async () => {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ username: "admin", password: adminPassword }),
  });
  const body = await res.json();
  const setCookie = res.headers.getSetCookie()[0] ?? "";
  const cookie = setCookie.split(";")[0];
  return { csrfToken: body.csrfToken as string, cookie };
};

const waitForMessage = (
  ws: WebSocket,
  predicate: (msg: unknown) => boolean,
  timeoutMs = 1500,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for a message")),
      timeoutMs,
    );
    ws.addEventListener("message", (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (predicate(msg)) {
          clearTimeout(timer);
          resolve(msg);
        }
      } catch {
        /* ignore non-JSON */
      }
    });
  });

const waitForClose = (ws: WebSocket, timeoutMs = 1500): Promise<number> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for close")),
      timeoutMs,
    );
    ws.addEventListener("close", (event: CloseEvent) => {
      clearTimeout(timer);
      resolve(event.code);
    });
  });

before(async () => {
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_SESSION_SECRET = "s".repeat(32);
  process.env.ADMIN_PASSWORD_HASH = await hashAdminPassword(adminPassword);

  server = startServer(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server?.close();
});

test("POST /api/rooms creates a room whose URL loads", async () => {
  const { res, body } = await createRoomViaApi();
  assert.equal(res.status, 201);
  assert.ok(typeof body?.slug === "string");
  assert.equal(body.url, `/r/${body.slug}`);

  const page = await fetch(`${baseUrl}/r/${body.slug}`);
  assert.equal(page.status, 200);
});

test("unknown and malformed room slugs return 404", async () => {
  const unknown = await fetch(`${baseUrl}/r/aaaaaaaa`);
  assert.equal(unknown.status, 404);

  const malformed = await fetch(`${baseUrl}/r/doesnotexist`);
  assert.equal(malformed.status, 404);
});

test("messages broadcast only within their room", async () => {
  const roomA = (await createRoomViaApi()).body;
  const roomB = (await createRoomViaApi()).body;
  const port = (server.address() as AddressInfo).port;
  const wsA = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomA.slug}`);
  const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomB.slug}`);

  await Promise.all([once(wsA, "open"), once(wsB, "open")]);

  wsA.send(
    JSON.stringify({
      type: "message:send",
      message: { username: "Isolated", body: "only in A" },
    }),
  );

  await waitForMessage(wsA, (msg) => (msg as { type?: string }).type === "message:new");

  let bReceived = false;
  wsB.addEventListener("message", () => {
    bReceived = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(bReceived, false);

  wsA.close();
  wsB.close();
});

test("connecting to an expired room closes with code 4004", async () => {
  const { body } = await createRoomViaApi();
  const slug = body.slug;

  const conn = new DatabaseSync(databasePath);
  conn.prepare("UPDATE rooms SET expires_at = 1 WHERE slug = ?").run(slug);
  conn.close();

  const port = (server.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${slug}`);
  const code = await waitForClose(ws);
  assert.equal(code, 4004);

  const page = await fetch(`${baseUrl}/r/${slug}`);
  assert.equal(page.status, 404);
});

test("bursting room creation from one IP is rate limited", async () => {
  const xff = nextXff();
  let lastStatus = 0;

  for (let i = 0; i < 6; i++) {
    const { res } = await createRoomViaApi(xff);
    lastStatus = res.status;
  }

  assert.equal(lastStatus, 429);
});

test("unauthenticated admin room access is rejected", async () => {
  const getRes = await fetch(`${baseUrl}/api/admin/rooms`);
  assert.equal(getRes.status, 401);

  const deleteRes = await fetch(`${baseUrl}/api/admin/rooms/1`, {
    method: "DELETE",
  });
  assert.equal(deleteRes.status, 401);
});

test("an admin can close a room, ejecting and 404ing it", async () => {
  const { body } = await createRoomViaApi();
  const slug = body.slug;
  const room = getRoomBySlug(slug);
  assert.ok(room !== null);

  const port = (server.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${slug}`);
  await once(ws, "open");

  const { csrfToken, cookie } = await loginAdmin();

  const closedPromise = waitForMessage(ws, (msg) => (msg as { type?: string }).type === "room:closed");
  const closeRes = await fetch(`${baseUrl}/api/admin/rooms/${room!.id}`, {
    method: "DELETE",
    headers: {
      "X-Admin-Action": "1",
      "X-CSRF-Token": csrfToken,
      Cookie: cookie,
      Origin: baseUrl,
    },
  });
  assert.equal(closeRes.status, 200);

  await closedPromise;
  const code = await waitForClose(ws);
  assert.equal(code, 4004);

  const page = await fetch(`${baseUrl}/r/${slug}`);
  assert.equal(page.status, 404);

  const conn = new DatabaseSync(databasePath);
  const row = conn
    .prepare(
      "SELECT action, room_slug, moderator FROM moderation_actions WHERE room_slug = ?",
    )
    .get(slug) as
    | { action: string; room_slug: string; moderator: string }
    | undefined;
  conn.close();

  assert.ok(row !== undefined);
  assert.equal(row.action, "room:close");
  assert.equal(row.room_slug, slug);
  assert.equal(row.moderator, "admin");
});
