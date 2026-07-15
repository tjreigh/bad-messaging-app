const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_BODY_LENGTH,
  MAX_USERNAME_LENGTH,
  createNewMessageEvent,
  decodeClientEvent,
} = require("./protocol");

test("decodes a history request", () => {
  const result = decodeClientEvent(JSON.stringify({ type: "history:request" }));

  assert.deepEqual(result, {
    ok: true,
    event: { type: "history:request" },
  });
});

test("decodes and trims a message", () => {
  const result = decodeClientEvent(JSON.stringify({
    type: "message:send",
    message: {
      username: "  Trevor  ",
      body: "  Hello  ",
    },
  }));

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
  assert.equal(result.error, "Message must be valid JSON");
});

test("rejects an unknown event type", () => {
  const result = decodeClientEvent(JSON.stringify({ type: "something:else" }));

  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown message type/);
});

const invalidMessages = [
  ["missing payload", undefined],
  ["missing username", { body: "Hello" }],
  ["missing body", { username: "Trevor" }],
  ["blank username", { username: "   ", body: "Hello" }],
  ["blank body", { username: "Trevor", body: "   " }],
  ["long username", { username: "x".repeat(MAX_USERNAME_LENGTH + 1), body: "Hello" }],
  ["long body", { username: "Trevor", body: "x".repeat(MAX_BODY_LENGTH + 1) }],
];

for (const [name, message] of invalidMessages) {
  test(`rejects a message with ${name}`, () => {
    const result = decodeClientEvent(JSON.stringify({
      type: "message:send",
      message,
    }));

    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
  });
}

test("constructs a trusted message without copying extra client fields", () => {
  const event = createNewMessageEvent({
    username: "Trevor",
    body: "Hello",
    timestamp: 1,
    admin: true,
  }, 12345);

  assert.deepEqual(event, {
    type: "message:new",
    message: {
      username: "Trevor",
      body: "Hello",
      timestamp: 12345,
    },
  });
});
