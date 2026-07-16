import { randomBytes } from "node:crypto";

import { hashAdminPassword } from "./admin-auth";

async function main(): Promise<void> {
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await hashAdminPassword(password);
  const sessionSecret = randomBytes(32).toString("base64url");

  console.log("Generated admin credentials. Save the password in a password manager.");
  console.log();
  console.log(`Username: admin`);
  console.log(`Password: ${password}`);
  console.log();
  console.log("Set these only in the server environment:");
  console.log(`ADMIN_USERNAME=admin`);
  console.log(`ADMIN_PASSWORD_HASH=${passwordHash}`);
  console.log(`ADMIN_SESSION_SECRET=${sessionSecret}`);
}

void main().catch((error: unknown) => {
  console.error("Could not generate admin credentials", error);
  process.exitCode = 1;
});
