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
  const socket = new WebSocket("ws://localhost:3000");
  const messageForm = document.getElementById("message-send-form");

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const username = formData.get("username");
    const messageBody = formData.get("message");

    const message = {
      username,
      timestamp: Date.now(),
      body: messageBody,
    };

    addMessage(message);
    socket.send(`sendMessage ${JSON.stringify(message)}`);
    console.log("sent");
  });

  socket.addEventListener("open", (event) => {
    console.log("Socket opened");
    socket.send("getAllMessages");
  });

  socket.addEventListener("message", (event) => {
    let msg = String(event.data);
    console.log(`Received: ${msg}`);

    if (msg.startsWith("allMessages")) {
      let rawMessages = msg.substring(12);
      console.log(rawMessages);
      let messages = JSON.parse(rawMessages);
      console.log(messages);

      messages.forEach((message) => {
        addMessage(message);
      });
    }
  });

  socket.addEventListener("error", (event) => {
    console.error(`Error in socket: ${event}`);
  });

  socket.addEventListener("close", () => {
    console.log("Socket closed");
  });
});
