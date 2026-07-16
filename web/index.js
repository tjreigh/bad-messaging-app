const ready = (callback) => {
  if (document.readyState != "loading") callback();
  else document.addEventListener("DOMContentLoaded", callback);
};

let messages = [];
const messageIds = new Set();
const USERNAME_STORAGE_KEY = "bad-messaging-app:username";

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

const addMessage = (message, prepend = false) => {
  if (messageIds.has(message.id)) {
    return;
  }

  const messageList = document.getElementById("message-list");
  messageIds.add(message.id);
  messages.push(message);

  const newMessage = document.createElement("article");
  const messageMeta = document.createElement("header");
  const username = document.createElement("span");
  const time = document.createElement("time");
  const body = document.createElement("p");
  const timestamp = new Date(message.timestamp);

  newMessage.className = "message";
  newMessage.dataset.messageId = String(message.id);
  messageMeta.className = "message__meta";
  username.className = "message__username";
  time.className = "message__time";
  body.className = "message__body";

  username.textContent = message.username;
  time.dateTime = timestamp.toISOString();
  time.textContent = messageTimeFormatter.format(timestamp);
  time.title = timestamp.toLocaleString();
  body.textContent = message.body;

  messageMeta.append(username, time);
  newMessage.append(messageMeta, body);

  if (prepend) {
    messageList.prepend(newMessage);
  } else {
    messageList.appendChild(newMessage);
  }
};

ready(() => {
  const roomMatch = location.pathname.match(/^\/r\/([A-Za-z0-9_-]{8})$/);
  const roomSlug = roomMatch ? roomMatch[1] : null;

  const createRoomBar = document.getElementById("create-room-bar");
  const createRoomButton = document.getElementById("create-room");
  const messageSend = document.getElementById("message-send");

  if (roomSlug === null) {
    createRoomBar.hidden = false;
  }

  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = roomSlug
    ? `${wsProtocol}://${location.host}/ws?room=${roomSlug}`
    : `${wsProtocol}://${location.host}/ws`;
  const socket = new WebSocket(wsUrl);
  const messageForm = document.getElementById("message-send-form");
  const sendButton = messageForm.querySelector('button[type="submit"]');
  const usernameInput = document.getElementById("username");
  const messageInput = document.getElementById("message");
  const connectionStatus = document.getElementById("connection-status");
  const messageStatus = document.getElementById("message-status");
  const loadOlderButton = document.getElementById("load-older");
  let historyLoaded = false;
  let historyRequestPending = true;
  let nextHistoryCursor = null;
  let roomClosed = false;

  try {
    const savedUsername = localStorage.getItem(USERNAME_STORAGE_KEY);

    if (savedUsername !== null) {
      usernameInput.value = savedUsername;
    }
  } catch (error) {
    console.error("Could not load the saved username", error);
  }

  usernameInput.addEventListener("input", () => {
    try {
      localStorage.setItem(USERNAME_STORAGE_KEY, usernameInput.value);
    } catch (error) {
      console.error("Could not save the username", error);
    }
  });

  const setConnectionState = (state, label) => {
    connectionStatus.dataset.state = state;
    connectionStatus.textContent = label;
    sendButton.disabled = state !== "connected" || roomClosed;
    loadOlderButton.disabled = state !== "connected" || historyRequestPending;
  };

  const setMessageStatus = (message, state) => {
    messageStatus.hidden = false;
    messageStatus.dataset.state = state;
    messageStatus.textContent = message;
  };

  const markRoomClosed = () => {
    if (roomClosed) {
      return;
    }

    roomClosed = true;
    setConnectionState("disconnected", "Room closed");
    setMessageStatus("This room has been closed.", "error");
    messageSend.hidden = true;
    loadOlderButton.hidden = true;
  };

  createRoomButton.addEventListener("click", async () => {
    createRoomButton.disabled = true;
    createRoomButton.textContent = "Creating…";

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error ?? `Could not create room (${response.status})`);
      }

      location.href = data.url;
    } catch (error) {
      createRoomButton.disabled = false;
      createRoomButton.textContent = "create a room";
      console.error("Could not create a room", error);
    }
  });

  loadOlderButton.addEventListener("click", () => {
    if (
      socket.readyState !== WebSocket.OPEN ||
      historyRequestPending ||
      nextHistoryCursor === null
    ) {
      return;
    }

    historyRequestPending = true;
    loadOlderButton.disabled = true;
    loadOlderButton.textContent = "Loading older messages…";
    socket.send(JSON.stringify({
      type: "history:request",
      before: nextHistoryCursor
    }));
  });

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (socket.readyState !== WebSocket.OPEN) {
      setConnectionState("disconnected", "Not connected");
      return;
    }

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

    try {
      socket.send(JSON.stringify(message));
      messageInput.value = "";
      messageInput.focus();
    } catch (error) {
      setConnectionState("disconnected", "Not connected");
      console.error("Could not send message", error);
    }
  });

  socket.addEventListener("open", () => {
    setConnectionState("connected", "Connected");
    socket.send(JSON.stringify({
      type: "history:request"
    }));
  });

  socket.addEventListener("message", (event) => {
    let msg;

    try {
      msg = JSON.parse(event.data);
    } catch (error) {
      console.error("Received an invalid server message", error);
      return;
    }

    switch (msg.type) {
      case "history":
        historyLoaded = true;
        historyRequestPending = false;
        nextHistoryCursor = msg.nextBefore ?? null;
        messageStatus.hidden = messages.length > 0 || msg.messages.length > 0;
        loadOlderButton.hidden = nextHistoryCursor === null || roomClosed;
        loadOlderButton.disabled = socket.readyState !== WebSocket.OPEN;
        loadOlderButton.textContent = "Load older messages";

        if (messages.length === 0 && msg.messages.length === 0) {
          setMessageStatus("No messages yet. Suspiciously quiet.", "empty");
        }

        msg.messages.forEach((message) => {
          addMessage(message);
        });
        break;
      case "message:new":
        messageStatus.hidden = true;
        addMessage(msg.message, true);
        break;
      case "message:delete": {
        const deletedMessage = document.querySelector(
          `.message[data-message-id="${msg.id}"]`
        );

        deletedMessage?.remove();
        messageIds.delete(msg.id);
        messages = messages.filter((message) => message.id !== msg.id);

        if (messages.length === 0) {
          setMessageStatus("No messages yet. Suspiciously quiet.", "empty");
        }
        break;
      }
      case "room:closed":
        markRoomClosed();
        break;
      case "error":
        console.error(`Server rejected a message: ${msg.message}`);
        break;
    }
  });

  socket.addEventListener("error", (event) => {
    setConnectionState("disconnected", "Connection error");

    if (!historyLoaded) {
      setMessageStatus("Messages could not be loaded.", "error");
    }

    console.error(`Error in socket: ${event}`);
  });

  socket.addEventListener("close", (event) => {
    if (event.code === 4004) {
      markRoomClosed();
      return;
    }

    setConnectionState("disconnected", "Disconnected");

    if (!historyLoaded) {
      setMessageStatus("Messages could not be loaded while disconnected.", "error");
    }
  });
});
