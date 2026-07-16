const loginPanel = document.getElementById("login-panel");
const loginForm = document.getElementById("login-form");
const dashboard = document.getElementById("dashboard");
const adminStatus = document.getElementById("admin-status");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("message-search");
const messageResultStatus = document.getElementById("message-result-status");
const messageList = document.getElementById("admin-message-list");
const loadOlderButton = document.getElementById("admin-load-older");
const logoutButton = document.getElementById("logout");

let csrfToken = null;
let nextBefore = null;
let currentQuery = "";

const setStatus = (message, error = false) => {
  adminStatus.textContent = message;
  adminStatus.dataset.state = error ? "error" : "ready";
};

const showLogin = (message = "Authentication required") => {
  csrfToken = null;
  dashboard.hidden = true;
  loginPanel.hidden = false;
  setStatus(message);
};

const showDashboard = (session) => {
  csrfToken = session.csrfToken;
  loginPanel.hidden = true;
  dashboard.hidden = false;
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

const renderMessage = (message) => {
  const article = document.createElement("article");
  const header = document.createElement("header");
  const username = document.createElement("strong");
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

  header.append(username, time);
  actions.appendChild(deleteButton);
  article.append(header, body, actions);

  return article;
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
    await loadMessages(true);
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

loadOlderButton.addEventListener("click", () => {
  if (nextBefore !== null) {
    void loadMessages(false);
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
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }

    loginPanel.hidden = true;
    dashboard.hidden = true;
    setStatus(error.message, true);
  }
};

void initialize();
