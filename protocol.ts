export const MAX_USERNAME_LENGTH = 32;
export const MAX_BODY_LENGTH = 500;

export interface MessageInput {
  username: string;
  body: string;
}

export interface Message extends MessageInput {
  id: number;
  timestamp: number;
}

export type ClientEvent =
  | { type: "history:request" }
  | { type: "message:send"; message: MessageInput };

export type ServerEvent =
  | { type: "error"; message: string }
  | { type: "history"; messages: Message[] }
  | { type: "message:new"; message: Message };

export type DecodeResult =
  | { ok: true; event: ClientEvent }
  | { ok: false; error: string };

export function decodeClientEvent(rawData: unknown): DecodeResult {
  let event: unknown;

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

function decodeMessageSend(message: unknown): DecodeResult {
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

export function createHistoryEvent(messages: Message[]): ServerEvent {
  return {
    type: "history",
    messages,
  };
}

export function createNewMessageEvent(message: Message): ServerEvent {
  return {
    type: "message:new",
    message: {
      id: message.id,
      username: message.username,
      body: message.body,
      timestamp: message.timestamp,
    },
  };
}

export function createErrorEvent(message: string): ServerEvent {
  return {
    type: "error",
    message,
  };
}

export function encodeEvent(event: ServerEvent): string {
  return JSON.stringify(event);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valid(event: ClientEvent): DecodeResult {
  return { ok: true, event };
}

function invalid(error: string): DecodeResult {
  return { ok: false, error };
}
