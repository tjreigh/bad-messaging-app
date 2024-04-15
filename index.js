const ready = (callback) => {
  if (document.readyState != "loading") callback();
  else document.addEventListener("DOMContentLoaded", callback);
};

let messages = [];

const addMessage = (message) => {
  const messageViewer = document.getElementById("message-viewer");
  messages.push(message);
  const newMessage = document.createElement("p");
  newMessage.textContent = message;
  messageViewer.appendChild(newMessage);
};

ready(() => {
  const socket = new WebSocket("ws://localhost:3000");
  const messageForm = document.getElementById("message-send-form");

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const message = formData.get("message");
    addMessage(message);
    socket.send(`sendMessage ${message}`);
    console.log("sent");
  });

  socket.addEventListener("open", (event) => {
    console.log("Socket opened");
    socket.send("getAllMessages");
  });

  socket.addEventListener("message", (event) => {
    let msg = String(event.data);
    console.log(`Received: ${msg}`);
    console.log(typeof msg);

    if (msg.startsWith("allMessages")) {
      let messages = msg.split(" ", 2)[1].split(",");
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
