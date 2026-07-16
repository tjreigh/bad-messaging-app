const loginPanel = document.getElementById("login-panel");
const loginForm = document.getElementById("login-form");
const dashboard = document.getElementById("dashboard");
const roomsPanel = document.getElementById("rooms-panel");
const adminStatus = document.getElementById("admin-status");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("message-search");
const messageFilterNote = document.getElementById("message-filter-note");
const messageResultStatus = document.getElementById("message-result-status");
const messageList = document.getElementById("admin-message-list");
const loadOlderButton = document.getElementById("admin-load-older");
const logoutButton = document.getElementById("logout");

const roomSearchForm = document.getElementById("room-search-form");
const roomSearchInput = document.getElementById("room-search");
const roomResultStatus = document.getElementById("room-result-status");
const roomList = document.getElementById("admin-room-list");
const roomsLoadOlderButton = document.getElementById("admin-rooms-load-older");

let csrfToken = null;
let nextBefore = null;
let currentQuery = "";
let currentRoomFilter = null;

let roomNextBefore = null;
let currentRoomQuery = "";

const setStatus = (message, error = false) => {
  adminStatus.textContent = message;
  adminStatus.dataset.state = error ? "error" : "ready";
};

const showLogin = (message = "Authentication required") => {
  csrfToken = null;
  dashboard.hidden = true;
  roomsPanel.hidden = true;
  loginPanel.hidden = false;
  setStatus(message);
};

const showDashboard = (session) => {
  csrfToken = session.csrfToken;
  loginPanel.hidden = true;
  dashboard.hidden = false;
  roomsPanel.hidden = false;
  setStatus(`Signed in as ${session.username}`);
};

const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  let body = null;

  if (response.status !== 204) {
    body = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const error = new Error(body?.error ?? `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return body;
};

const adminActionHeaders = () => ({
  "X-Admin-Action": "1",
  "X-CSRF-Token": csrfToken
});

const formatTimestamp = (value) => {
  if (value === null) {
    return "never";
  }

  return new Date(value).toLocaleString();
};

const renderMessage = (message) => {
  const article = document.createElement("article");
  const header = document.createElement("header");
  const username = document.createElement("strong");
  const roomTag = document.createElement("span");
  const time = document.createElement("time");
  const body = document.createElement("p");
  const actions = document.createElement("div");
  const deleteButton = document.createElement("button");
  const timestamp = new Date(message.timestamp);

  article.className = "admin-message";
  article.dataset.messageId = String(message.id);
  header.className = "admin-message__meta";
  actions.className = "admin-message__actions";
  username.textContent = message.username;
  roomTag.className = "admin-message__room";
  roomTag.textContent = `#${message.roomSlug}`;
  time.dateTime = timestamp.toISOString();
  time.textContent = timestamp.toLocaleString();
  body.textContent = message.body;
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";

  deleteButton.addEventListener("click", async () => {
    if (!window.confirm("Delete this message?")) {
      return;
    }

    deleteButton.disabled = true;

    try {
      await request(`/api/admin/messages/${message.id}`, {
        method: "DELETE",
        headers: adminActionHeaders()
      });
      article.remove();
      setStatus("Message deleted");
    } catch (error) {
      deleteButton.disabled = false;
      handleRequestError(error);
    }
  });

  header.append(username, roomTag, time);
  actions.appendChild(deleteButton);
  article.append(header, body, actions);

  return article;
};

const renderRoom = (room) => {
  const article = document.createElement("article");
  const header = document.createElement("header");
  const slug = document.createElement("strong");
  const meta = document.createElement("span");
  const expiry = document.createElement("time");
  const actions = document.createElement("div");
  const viewMessagesButton = document.createElement("button");
  const closeButton = document.createElement("button");

  article.className = "admin-room";
  article.dataset.roomId = String(room.id);
  header.className = "admin-room__meta";
  meta.className = "admin-room__count";
  actions.className = "admin-room__actions";
  slug.textContent = room.slug;

  const isPermanent = room.expiresAt === null;
  meta.textContent = `${room.messageCount} message${room.messageCount === 1 ? "" : "s"}`;
  expiry.dateTime = room.expiresAt === null ? "" : new Date(room.expiresAt).toISOString();
  expiry.textContent = isPermanent ? "permanent" : `expires ${formatTimestamp(room.expiresAt)}`;

  viewMessagesButton.type = "button";
  viewMessagesButton.textContent = "View messages";
  viewMessagesButton.addEventListener("click", () => {
    filterMessagesByRoom(room.id, room.slug);
  });

  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.disabled = isPermanent;
  closeButton.title = isPermanent ? "Permanent rooms cannot be closed" : "";
  closeButton.addEventListener("click", async () => {
    if (!window.confirm(`Close room ${room.slug}? Messages will be deleted.`)) {
      return;
    }

    closeButton.disabled = true;

    try {
      await request(`/api/admin/rooms/${room.id}`, {
        method: "DELETE",
        headers: adminActionHeaders()
      });
      article.remove();
      setStatus(`Room ${room.slug} closed`);
    } catch (error) {
      closeButton.disabled = false;
      handleRequestError(error);
    }
  });

  header.append(slug, meta, expiry);
  actions.append(viewMessagesButton, closeButton);
  article.append(header, actions);

  return article;
};

const filterMessagesByRoom = (roomId, slug) => {
  currentRoomFilter = roomId;
  messageFilterNote.innerHTML = "";
  const label = document.createElement("span");
  label.textContent = `Filtering messages by room #${slug} `;
  const clearLink = document.createElement("button");
  clearLink.type = "button";
  clearLink.className = "room-filter-note__clear";
  clearLink.textContent = "clear";
  clearLink.addEventListener("click", () => {
    currentRoomFilter = null;
    messageFilterNote.hidden = true;
    void loadMessages(true);
  });
  messageFilterNote.append(label, clearLink);
  messageFilterNote.hidden = false;
  void loadMessages(true);
};

const loadMessages = async (reset = false) => {
  if (reset) {
    nextBefore = null;
    messageList.replaceChildren();
  }

  messageResultStatus.hidden = false;
  messageResultStatus.textContent = reset
    ? "Loading messages…"
    : "Loading older messages…";
  loadOlderButton.disabled = true;

  const parameters = new URLSearchParams();

  if (!reset && nextBefore !== null) {
    parameters.set("before", String(nextBefore));
  }

  if (currentQuery !== "") {
    parameters.set("q", currentQuery);
  }

  if (currentRoomFilter !== null) {
    parameters.set("room", String(currentRoomFilter));
  }

  try {
    const page = await request(`/api/admin/messages?${parameters}`);

    page.messages.forEach((message) => {
      messageList.appendChild(renderMessage(message));
    });

    nextBefore = page.nextBefore ?? null;
    loadOlderButton.hidden = nextBefore === null;
    loadOlderButton.disabled = false;
    messageResultStatus.hidden = messageList.children.length > 0;

    if (messageList.children.length === 0) {
      messageResultStatus.textContent = "No messages";
    }
  } catch (error) {
    messageResultStatus.hidden = true;
    handleRequestError(error);
  }
};

const loadRooms = async (reset = false) => {
  if (reset) {
    roomNextBefore = null;
    roomList.replaceChildren();
  }

  roomResultStatus.hidden = false;
  roomResultStatus.textContent = reset
    ? "Loading rooms…"
    : "Loading older rooms…";
  roomsLoadOlderButton.disabled = true;

  const parameters = new URLSearchParams();

  if (!reset && roomNextBefore !== null) {
    parameters.set("before", String(roomNextBefore));
  }

  if (currentRoomQuery !== "") {
    parameters.set("q", currentRoomQuery);
  }

  try {
    const page = await request(`/api/admin/rooms?${parameters}`);

    page.rooms.forEach((room) => {
      roomList.appendChild(renderRoom(room));
    });

    roomNextBefore = page.nextBefore ?? null;
    roomsLoadOlderButton.hidden = roomNextBefore === null;
    roomsLoadOlderButton.disabled = false;
    roomResultStatus.hidden = roomList.children.length > 0;

    if (roomList.children.length === 0) {
      roomResultStatus.textContent = "No rooms";
    }
  } catch (error) {
    roomResultStatus.hidden = true;
    handleRequestError(error);
  }
};

const handleRequestError = (error) => {
  if (error.status === 401) {
    showLogin("Session expired");
    return;
  }

  setStatus(error.message, true);
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector('button[type="submit"]');
  const formData = new FormData(loginForm);

  submitButton.disabled = true;
  setStatus("Signing in…");

  try {
    const session = await request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password")
      })
    });

    loginForm.reset();
    showDashboard(session);
    void loadMessages(true);
    void loadRooms(true);
  } catch (error) {
    handleRequestError(error);
  } finally {
    submitButton.disabled = false;
  }
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  currentQuery = searchInput.value.trim();
  void loadMessages(true);
});

roomSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  currentRoomQuery = roomSearchInput.value.trim();
  void loadRooms(true);
});

loadOlderButton.addEventListener("click", () => {
  if (nextBefore !== null) {
    void loadMessages(false);
  }
});

roomsLoadOlderButton.addEventListener("click", () => {
  if (roomNextBefore !== null) {
    void loadRooms(false);
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", {
      method: "POST",
      headers: adminActionHeaders()
    });
  } catch (error) {
    if (error.status !== 401) {
      handleRequestError(error);
      return;
    }
  }

  showLogin("Signed out");
});

const initialize = async () => {
  try {
    const session = await request("/api/admin/session");
    showDashboard(session);
    await loadMessages(true);
    await loadRooms(true);
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }

    loginPanel.hidden = true;
    dashboard.hidden = true;
    roomsPanel.hidden = true;
    setStatus(error.message, true);
  }
};

void initialize();
