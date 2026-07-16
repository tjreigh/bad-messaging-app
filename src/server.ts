import express from "express";
import expressWs from "express-ws";
import { join } from "node:path";
import type { Server } from "node:http";
import type { WebSocket } from "ws";

import { createAdminRouter } from "./admin";
import {
  countActiveRooms,
  createMessage,
  createRoom,
  deleteExpiredRooms,
  getRoomById,
  getRoomBySlug,
  listRecentMessages,
} from "./database";
import {
  createErrorEvent,
  createHistoryEvent,
  createMessageDeletedEvent,
  createNewMessageEvent,
  createRoomClosedEvent,
  decodeClientEvent,
  encodeEvent,
  type ServerEvent,
} from "./protocol";
import { generateRoomSlug, isValidRoomSlug } from "./slug";
import { createRateLimiter } from "./rate-limit";
import { hasSameOrigin } from "./http-utils";

const MAX_ACTIVE_ROOMS = 100;
const SLUG_RETRY_LIMIT = 5;
const ROOM_CREATION_LIMIT = 5;
const ROOM_CREATION_WINDOW_MS = 10 * 60 * 1000;
const ROOM_CREATION_MAX_KEYS = 1_000;
const MESSAGE_LIMIT = 10;
const MESSAGE_WINDOW_MS = 10_000;
const EXPIRATION_SWEEP_INTERVAL_MS = 60_000;
const WEBSOCKET_HEARTBEAT_INTERVAL_MS = 30_000;
const ROOM_UNAVAILABLE_CLOSE_CODE = 4004;

export function startServer(
  port: number = Number.parseInt(process.env.PORT ?? "3000", 10),
  host: string = process.env.HOST ?? "127.0.0.1",
): Server {
  const expressWsInstance = expressWs(express());
  const app = expressWsInstance.app;

  app.set("trust proxy", "loopback");

  const roomConnections = new Map<number, Set<WebSocket>>();
  const socketLiveness = new WeakMap<WebSocket, boolean>();
  const roomCreationLimiter = createRateLimiter({
    max: ROOM_CREATION_LIMIT,
    windowMs: ROOM_CREATION_WINDOW_MS,
    maxTrackedKeys: ROOM_CREATION_MAX_KEYS,
  });

  app.use("/api/admin", createAdminRouter({
    onMessageDeleted: (messageId, roomId) => {
      broadcastToRoom(roomId, createMessageDeletedEvent(messageId));
    },
    onRoomClosed: (roomId) => {
      broadcastToRoom(roomId, createRoomClosedEvent());
      closeRoomSockets(roomId);
    },
  }));

  app.post(
    "/api/rooms",
    express.json({ limit: "1kb" }),
    (request, response) => {
      if (!hasSameOrigin(request)) {
        response.status(403).json({ error: "Cross-origin request rejected" });
        return;
      }

      const ip = request.ip ?? "unknown";

      if (!roomCreationLimiter.consume(ip)) {
        response.status(429).json({ error: "Too many room creations" });
        return;
      }

      if (countActiveRooms() >= MAX_ACTIVE_ROOMS) {
        response.status(503).json({ error: "Room capacity reached" });
        return;
      }

      const now = Date.now();
      let room = null;

      for (let attempt = 0; attempt < SLUG_RETRY_LIMIT; attempt++) {
        try {
          room = createRoom(generateRoomSlug(), now);
          break;
        } catch (error) {
          if (!isUniqueConstraintError(error)) {
            throw error;
          }
          // UNIQUE collision on slug — generate a fresh one and retry.
        }
      }

      if (room === null) {
        response.status(503).json({ error: "Could not create room" });
        return;
      }

      response.status(201).json({ slug: room.slug, url: `/r/${room.slug}` });
    },
  );

  app.get("/r/:slug", (request, response) => {
    const slug = request.params.slug;

    if (!isValidRoomSlug(slug)) {
      response.status(404).send("Not found");
      return;
    }

    const room = getRoomBySlug(slug);

    if (room === null || (room.expiresAt !== null && room.expiresAt <= Date.now())) {
      response.status(404).send("Not found");
      return;
    }

    response.sendFile(join(__dirname, "public", "index.html"));
  });

  app.use(express.static(join(__dirname, "public")));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.ws("/ws", (ws, request) => {
    const roomId = resolveRoomId(request);

    if (roomId === null) {
      ws.close(ROOM_UNAVAILABLE_CLOSE_CODE, "room unavailable");
      return;
    }

    addConnection(roomId, ws);

    const messageLimiter = createRateLimiter({
      max: MESSAGE_LIMIT,
      windowMs: MESSAGE_WINDOW_MS,
      maxTrackedKeys: 1,
    });

    ws.on("message", (rawMessage) => {
      const result = decodeClientEvent(rawMessage);

      if (!result.ok) {
        sendEvent(ws, createErrorEvent(result.error));
        return;
      }

      const event = result.event;

      switch (event.type) {
        case "message:send": {
          if (!messageLimiter.consume("message")) {
            sendEvent(ws, createErrorEvent("You are sending messages too quickly"));
            return;
          }

          const room = getRoomById(roomId);

          if (room === null || (room.expiresAt !== null && room.expiresAt <= Date.now())) {
            sendEvent(ws, createErrorEvent("room closed"));
            ws.close(ROOM_UNAVAILABLE_CLOSE_CODE, "room unavailable");
            return;
          }

          const savedMessage = createMessage(event.message, roomId);
          broadcastToRoom(roomId, createNewMessageEvent(savedMessage));
          break;
        }

        case "history:request": {
          const page = listRecentMessages(roomId, 25, event.before);
          sendEvent(ws, createHistoryEvent(page.messages, page.nextBefore));
          break;
        }
      }
    });

    ws.on("close", () => {
      removeConnection(roomId, ws);
    });
  });

  function sendEvent(ws: WebSocket, event: ServerEvent): void {
    ws.send(encodeEvent(event));
  }

  function broadcastToRoom(roomId: number, event: ServerEvent): void {
    const sockets = roomConnections.get(roomId);

    if (sockets === undefined) {
      return;
    }

    const serializedEvent = encodeEvent(event);

    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) {
        ws.send(serializedEvent);
      }
    }
  }

  function addConnection(roomId: number, ws: WebSocket): void {
    let sockets = roomConnections.get(roomId);

    if (sockets === undefined) {
      sockets = new Set();
      roomConnections.set(roomId, sockets);
    }

    sockets.add(ws);
    socketLiveness.set(ws, true);
    ws.on("pong", () => {
      socketLiveness.set(ws, true);
    });
  }

  function removeConnection(roomId: number, ws: WebSocket): void {
    const sockets = roomConnections.get(roomId);

    if (sockets === undefined) {
      return;
    }

    sockets.delete(ws);

    if (sockets.size === 0) {
      roomConnections.delete(roomId);
    }
  }

  function closeRoomSockets(roomId: number): void {
    const sockets = roomConnections.get(roomId);

    if (sockets === undefined) {
      return;
    }

    for (const ws of sockets) {
      ws.close(ROOM_UNAVAILABLE_CLOSE_CODE, "room unavailable");
    }

    roomConnections.delete(roomId);
  }

  function resolveRoomId(request: import("node:http").IncomingMessage): number | null {
    const roomParam = parseRoomParam(request.url);

    if (roomParam === null) {
      const general = getRoomBySlug("general");
      return general === null ? null : general.id;
    }

    if (!isValidRoomSlug(roomParam)) {
      return null;
    }

    const room = getRoomBySlug(roomParam);

    if (room === null || (room.expiresAt !== null && room.expiresAt <= Date.now())) {
      return null;
    }

    return room.id;
  }

  const sweep = setInterval(() => {
    const deletedIds = deleteExpiredRooms(Date.now());

    for (const id of deletedIds) {
      broadcastToRoom(id, createRoomClosedEvent());
      closeRoomSockets(id);
    }
  }, EXPIRATION_SWEEP_INTERVAL_MS);
  sweep.unref();

  const heartbeat = setInterval(() => {
    for (const sockets of roomConnections.values()) {
      for (const ws of sockets) {
        if (ws.readyState !== ws.OPEN) {
          continue;
        }

        if (socketLiveness.get(ws) === false) {
          ws.terminate();
          continue;
        }

        socketLiveness.set(ws, false);
        ws.ping();
      }
    }
  }, WEBSOCKET_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  return app.listen(port, host, () => {
    console.log(`Bad Messaging App listening on http://${host}:${port}`);
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

function parseRoomParam(url: string | undefined): string | null {
  if (url === undefined) {
    return null;
  }

  const queryIndex = url.indexOf("?");

  if (queryIndex === -1) {
    return null;
  }

  const room = new URLSearchParams(url.slice(queryIndex + 1)).get("room");

  return room;
}

if (require.main === module) {
  startServer();
}
