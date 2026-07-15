const express = require("express");
const {
  createErrorEvent,
  createHistoryEvent,
  createNewMessageEvent,
  decodeClientEvent,
  encodeEvent,
} = require("./protocol");

const app = express();
const expressWs = require("express-ws")(app);

const messages = [];

app.use(express.static('public'));

app.ws("/ws", function (ws, req) {
  ws.on("message", function (rawMsg) {
    const result = decodeClientEvent(rawMsg);

    if (!result.ok) {
      sendEvent(ws, createErrorEvent(result.error));
      return;
    }

    const event = result.event;

    switch (event.type) {
      case "message:send": {
        const response = createNewMessageEvent(event.message);
        messages.push(response.message);

        broadcastEvent(response);

        break;
      }
      case "history:request": {
        sendEvent(ws, createHistoryEvent(messages));

        break;
      }
    }
  });
});

function sendEvent(ws, event) {
  ws.send(encodeEvent(event));
}

function broadcastEvent(event) {
  const serializedEvent = encodeEvent(event);
  const clients = expressWs.getWss().clients;

  clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(serializedEvent);
    }
  });
}

app.listen(3000);
