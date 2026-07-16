import express from "express";
import expressWs from "express-ws";
import { join } from "node:path";
import type { WebSocket } from "ws";

import { createMessage, listRecentMessages } from "./database";
import {
  createErrorEvent,
  createHistoryEvent,
  createNewMessageEvent,
  decodeClientEvent,
  encodeEvent,
  type ServerEvent,
} from "./protocol";

const expressWsInstance = expressWs(express());
const app = expressWsInstance.app;
const host = process.env.HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

app.use(express.static(join(__dirname, "public")));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.ws("/ws", (ws) => {
  ws.on("message", (rawMessage) => {
    const result = decodeClientEvent(rawMessage);

    if (!result.ok) {
      sendEvent(ws, createErrorEvent(result.error));
      return;
    }

    const event = result.event;

    switch (event.type) {
      case "message:send": {
        const savedMessage = createMessage(event.message);
        broadcastEvent(createNewMessageEvent(savedMessage));
        break;
      }

      case "history:request": {
        sendEvent(ws, createHistoryEvent(listRecentMessages(50)));
        break;
      }
    }
  });
});

function sendEvent(ws: WebSocket, event: ServerEvent): void {
  ws.send(encodeEvent(event));
}

function broadcastEvent(event: ServerEvent): void {
  const serializedEvent = encodeEvent(event);
  const clients = expressWsInstance.getWss().clients;

  clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(serializedEvent);
    }
  });
}

app.listen(port, host, () => {
  console.log(`Bad Messaging App listening on http://${host}:${port}`);
});
