const express = require("express");
const app = express();
const expressWs = require("express-ws")(app);

const messages = [];

app.use(express.static('public'));

app.ws("/ws", function (ws, req) {
  ws.on("message", function (rawMsg) {
    const strMsg = String(rawMsg)
    const msg = JSON.parse(strMsg);
    console.log(msg)
    switch (msg.type) {
      case "message:send": {
        const response = createNewMessageResponse(msg.message)
        messages.push(response.message);

        const serializedResponse = JSON.stringify(response);
        const clients = expressWs.getWss().clients

        clients.forEach((client) => {
          if (client.readyState == client.OPEN) {
            client.send(serializedResponse);
          }
        });

        break;
      }
      case "history:request": {
        const body = {
          type: "history",
          messages: messages
        }

        ws.send(JSON.stringify(body));

        break;
      }
    }
  });
});

function createNewMessageResponse(msg) {
  const message = {
    timestamp: Date.now(),
    ...msg
  }
  const response = {
    type: "message:new",
    message
  }
  return response
}

app.listen(3000);
