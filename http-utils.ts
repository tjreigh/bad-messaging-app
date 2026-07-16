import type { Request } from "express";

export function hasSameOrigin(request: Request): boolean {
  const origin = request.get("origin");
  const host = request.get("host");
  const protocol = request.protocol;

  if (!origin || !host || !protocol) {
    return false;
  }

  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}
