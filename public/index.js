const ready = (callback) => {
  if (document.readyState != "loading") callback();
  else document.addEventListener("DOMContentLoaded", callback);
};

let messages = [];

const addMessage = (message) => {
  const messageViewer = document.getElementById("message-viewer");
  messages.push(message);
  const newMessage = document.createElement("p");
  const timestamp = new Date(message.timestamp);
  const time = `on ${timestamp.toLocaleDateString()} at ${timestamp.toLocaleTimeString()}`
  newMessage.textContent = `${time} ${message.username}: ${message.body}`;
  messageViewer.appendChild(newMessage);
};

ready(() => {
  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${wsProtocol}://${location.host}/ws`);
  const messageForm = document.getElementById("message-send-form");

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const username = formData.get("username");
    const messageBody = formData.get("message");

    const message = {
      type: "message:send",
      message: {
        username,
        body: messageBody
      }
    };

    socket.send(JSON.stringify(message));
    messageForm.reset();
    console.log("sent");
  });

  socket.addEventListener("open", (event) => {
    console.log("Socket opened");
    socket.send(JSON.stringify({
      type: "history:request"
    }));
  });

  socket.addEventListener("message", (event) => {
    let msg = JSON.parse(event.data);
    console.log(`Received: ${JSON.stringify(msg)}`);

    switch (msg.type) {
      case "history":
        msg.messages.forEach((message) => {
          addMessage(message);
        });
        break;
      case "message:new":
        addMessage(msg.message)
    }
  });

  socket.addEventListener("error", (event) => {
    console.error(`Error in socket: ${event}`);
  });

  socket.addEventListener("close", () => {
    console.log("Socket closed");
  });
});
