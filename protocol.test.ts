import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BODY_LENGTH,
  MAX_USERNAME_LENGTH,
  createNewMessageEvent,
  decodeClientEvent,
} from "./protocol";

test("decodes a history request", () => {
  const result = decodeClientEvent(JSON.stringify({ type: "history:request" }));

  assert.deepEqual(result, {
    ok: true,
    event: { type: "history:request" },
  });
});

test("decodes and trims a message", () => {
  const result = decodeClientEvent(
    JSON.stringify({
      type: "message:send",
      message: {
        username: "  Trevor  ",
        body: "  Hello  ",
      },
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    event: {
      type: "message:send",
      message: {
        username: "Trevor",
        body: "Hello",
      },
    },
  });
});

test("rejects malformed JSON", () => {
  const result = decodeClientEvent("definitely not JSON");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "Message must be valid JSON");
  }
});

test("rejects an unknown event type", () => {
  const result = decodeClientEvent(JSON.stringify({ type: "something:else" }));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /Unknown message type/);
  }
});

const invalidMessages: ReadonlyArray<readonly [string, unknown]> = [
  ["missing payload", undefined],
  ["missing username", { body: "Hello" }],
  ["missing body", { username: "Trevor" }],
  ["blank username", { username: "   ", body: "Hello" }],
  ["blank body", { username: "Trevor", body: "   " }],
  [
    "long username",
    { username: "x".repeat(MAX_USERNAME_LENGTH + 1), body: "Hello" },
  ],
  ["long body", { username: "Trevor", body: "x".repeat(MAX_BODY_LENGTH + 1) }],
];

for (const [name, message] of invalidMessages) {
  test(`rejects a message with ${name}`, () => {
    const result = decodeClientEvent(
      JSON.stringify({
        type: "message:send",
        message,
      }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(typeof result.error, "string");
    }
  });
}

test("constructs a trusted message without copying extra fields", () => {
  const messageWithExtraField = {
    id: 7,
    username: "Trevor",
    body: "Hello",
    timestamp: 12345,
    admin: true,
  };
  const event = createNewMessageEvent(messageWithExtraField);

  assert.deepEqual(event, {
    type: "message:new",
    message: {
      id: 7,
      username: "Trevor",
      body: "Hello",
      timestamp: 12345,
    },
  });
});
