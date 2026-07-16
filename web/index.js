const ready = (callback) => {
  if (document.readyState != "loading") callback();
  else document.addEventListener("DOMContentLoaded", callback);
};

let messages = [];
const messageIds = new Set();
const USERNAME_STORAGE_KEY = "bad-messaging-app:username";
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

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
  const messageForm = document.getElementById("message-send-form");
  const sendButton = messageForm.querySelector('button[type="submit"]');
  const usernameInput = document.getElementById("username");
  const messageInput = document.getElementById("message");
  const connectionStatus = document.getElementById("connection-status");
  const messageStatus = document.getElementById("message-status");
  const loadOlderButton = document.getElementById("load-older");
  let historyLoaded = false;
  let historyRequestPending = true;
  let historyRequestKind = "initial";
  let nextHistoryCursor = null;
  let roomClosed = false;
  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;

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
      socket?.readyState !== WebSocket.OPEN ||
      historyRequestPending ||
      nextHistoryCursor === null
    ) {
      return;
    }

    historyRequestPending = true;
    historyRequestKind = "older";
    loadOlderButton.disabled = true;
    loadOlderButton.textContent = "Loading older messages…";
    socket.send(JSON.stringify({
      type: "history:request",
      before: nextHistoryCursor
    }));
  });

  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (socket?.readyState !== WebSocket.OPEN) {
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

  const scheduleReconnect = () => {
    if (roomClosed || reconnectTimer !== null) {
      return;
    }

    const baseDelay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_DELAY_MS
    );
    const jitter = Math.floor(Math.random() * baseDelay * 0.2);
    const delay = baseDelay + jitter;
    reconnectAttempts += 1;

    setConnectionState("connecting", "Reconnecting…");
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (
      roomClosed ||
      socket?.readyState === WebSocket.OPEN ||
      socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    setConnectionState("connecting", reconnectAttempts === 0
      ? "Connecting…"
      : "Reconnecting…");

    let currentSocket;

    try {
      currentSocket = new WebSocket(wsUrl);
      socket = currentSocket;
    } catch (error) {
      console.error("Could not open the WebSocket", error);
      scheduleReconnect();
      return;
    }

    currentSocket.addEventListener("open", () => {
      if (socket !== currentSocket) {
        return;
      }

      reconnectAttempts = 0;
      historyRequestPending = true;
      historyRequestKind = historyLoaded ? "refresh" : "initial";
      setConnectionState("connected", "Connected");
      currentSocket.send(JSON.stringify({
        type: "history:request"
      }));
    });

    currentSocket.addEventListener("message", (event) => {
      if (socket !== currentSocket) {
        return;
      }

      let msg;

      try {
        msg = JSON.parse(event.data);
      } catch (error) {
        console.error("Received an invalid server message", error);
        return;
      }

      switch (msg.type) {
        case "history": {
          const isRefresh = historyRequestKind === "refresh";
          historyLoaded = true;
          historyRequestPending = false;

          if (!isRefresh) {
            nextHistoryCursor = msg.nextBefore ?? null;
          }

          messageStatus.hidden = messages.length > 0 || msg.messages.length > 0;
          loadOlderButton.hidden = nextHistoryCursor === null || roomClosed;
          loadOlderButton.disabled = currentSocket.readyState !== WebSocket.OPEN;
          loadOlderButton.textContent = "Load older messages";

          if (messages.length === 0 && msg.messages.length === 0) {
            setMessageStatus("No messages yet. Suspiciously quiet.", "empty");
          }

          const historyMessages = isRefresh
            ? [...msg.messages].reverse()
            : msg.messages;

          historyMessages.forEach((message) => {
            addMessage(message, isRefresh);
          });
          break;
        }
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

    currentSocket.addEventListener("error", (event) => {
      if (socket !== currentSocket) {
        return;
      }

      setConnectionState("disconnected", "Connection error");

      if (!historyLoaded) {
        setMessageStatus("Messages could not be loaded.", "error");
      }

      console.error("WebSocket error", event);
    });

    currentSocket.addEventListener("close", (event) => {
      if (socket !== currentSocket) {
        return;
      }

      socket = null;
      historyRequestPending = false;

      console.warn("WebSocket closed", {
        code: event.code,
        reason: event.reason || "No reason supplied",
        wasClean: event.wasClean
      });

      if (event.code === 4004) {
        markRoomClosed();
        return;
      }

      if (!historyLoaded) {
        setMessageStatus("Messages could not be loaded while disconnected.", "error");
      }

      scheduleReconnect();
    });
  };

  window.addEventListener("online", () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    connect();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      connect();
    }
  });

  connect();
});
