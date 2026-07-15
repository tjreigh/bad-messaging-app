const MAX_USERNAME_LENGTH = 32;
const MAX_BODY_LENGTH = 500;

function decodeClientEvent(rawData) {
  let event;

  try {
    event = JSON.parse(String(rawData));
  } catch {
    return invalid("Message must be valid JSON");
  }

  if (!isObject(event) || typeof event.type !== "string") {
    return invalid("Message must have a type");
  }

  switch (event.type) {
    case "history:request":
      return valid({ type: "history:request" });

    case "message:send":
      return decodeMessageSend(event.message);

    default:
      return invalid(`Unknown message type: ${event.type}`);
  }
}

function decodeMessageSend(message) {
  if (!isObject(message)) {
    return invalid("Message payload is required");
  }

  if (typeof message.username !== "string") {
    return invalid("Username must be a string");
  }

  if (typeof message.body !== "string") {
    return invalid("Message body must be a string");
  }

  const username = message.username.trim();
  const body = message.body.trim();

  if (username.length === 0) {
    return invalid("Username is required");
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return invalid(`Username must be ${MAX_USERNAME_LENGTH} characters or fewer`);
  }

  if (body.length === 0) {
    return invalid("Message body is required");
  }

  if (body.length > MAX_BODY_LENGTH) {
    return invalid(`Message body must be ${MAX_BODY_LENGTH} characters or fewer`);
  }

  return valid({
    type: "message:send",
    message: { username, body },
  });
}

function createHistoryEvent(messages) {
  return {
    type: "history",
    messages,
  };
}

function createNewMessageEvent(message, timestamp = Date.now()) {
  return {
    type: "message:new",
    message: {
      username: message.username,
      body: message.body,
      timestamp,
    },
  };
}

function createErrorEvent(message) {
  return {
    type: "error",
    message,
  };
}

function encodeEvent(event) {
  return JSON.stringify(event);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valid(event) {
  return { ok: true, event };
}

function invalid(error) {
  return { ok: false, error };
}

module.exports = {
  MAX_BODY_LENGTH,
  MAX_USERNAME_LENGTH,
  createErrorEvent,
  createHistoryEvent,
  createNewMessageEvent,
  decodeClientEvent,
  encodeEvent,
};
