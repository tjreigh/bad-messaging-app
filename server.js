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
      case "message:send":
        doSendMessage(ws, msg.message)
        break;
      case "history:request":
        let body = {
          type: "history",
          messages: messages
        }
        ws.send(JSON.stringify(body));
        break;
    }
  });
});

function doSendMessage(ws, msg) {
  messages.push(msg);
  const message = {
    timestamp: Date.now(),
    ...msg
  }
  const response = {
    type: "message:new",
    message
  }
  ws.send(JSON.stringify(response));
}

app.listen(3000);
