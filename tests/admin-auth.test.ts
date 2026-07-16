import assert from "node:assert/strict";
import test from "node:test";

import {
  createAdminSession,
  hashAdminPassword,
  verifyAdminPassword,
  verifyAdminSession,
} from "../src/admin-auth";

test("hashes and verifies an admin password", async () => {
  const hash = await hashAdminPassword("correct horse battery staple");

  assert.equal(
    await verifyAdminPassword("correct horse battery staple", hash),
    true,
  );
  assert.equal(await verifyAdminPassword("incorrect", hash), false);
});

test("rejects malformed password hashes", async () => {
  assert.equal(await verifyAdminPassword("password", "sha256$nope"), false);
});

test("creates and verifies an admin session", () => {
  const now = 1_000_000;
  const { token, session } = createAdminSession("admin", "s".repeat(32), now);

  assert.deepEqual(verifyAdminSession(token, "s".repeat(32), now), session);
});

test("rejects tampered and expired admin sessions", () => {
  const now = 1_000_000;
  const secret = "s".repeat(32);
  const { token, session } = createAdminSession("admin", secret, now);

  assert.equal(verifyAdminSession(`${token}x`, secret, now), null);
  assert.equal(verifyAdminSession(token, "x".repeat(32), now), null);
  assert.equal(verifyAdminSession(token, secret, session.expiresAt), null);
});
