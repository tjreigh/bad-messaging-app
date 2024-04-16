const express = require("express");
const app = express();
const expressWs = require("express-ws")(app);

const messages = [];

app.use(function (req, res, next) {
  console.log("middleware");
  req.testing = "testing";
  return next();
});

app.get("/", function (req, res, next) {
  console.log("get route", req.testing);
  res.end();
});

app.ws("/", function (ws, req) {
  ws.on("message", function (msg) {
    console.log(msg);
    if (msg.startsWith("getAllMessages")) {
      ws.send(`allMessages [${messages}]`);
    } else if (msg.startsWith("sendMessage")) {
      let message = msg.split(" ").slice(1).join(" ");
      let body = JSON.parse(message).body;
      messages.push(message);
      ws.send(`acknowledged ${body}`);
    }
  });
  console.log("socket", req.testing);
});

app.listen(3000);
