import { randomBytes } from "node:crypto";

const SLUG_PATTERN = /^[A-Za-z0-9_-]{8}$/;

export function generateRoomSlug(): string {
  return randomBytes(6).toString("base64url");
}

export function isValidRoomSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}
