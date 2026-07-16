import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";

import {
  createAdminSession,
  safeEqualStrings,
  verifyAdminPassword,
  verifyAdminSession,
  type AdminSession,
} from "./admin-auth";
import {
  closeRoom,
  deleteMessage,
  getRoomById,
  listMessagesForAdmin,
  listRoomsForAdmin,
} from "./database";
import { hasSameOrigin } from "./http-utils";

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_ADDRESSES = 1_000;

interface AdminConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
}

interface AdminCallbacks {
  onMessageDeleted?: (messageId: number, roomId: number) => void;
  onRoomClosed?: (roomId: number) => void;
}

interface LoginAttempt {
  failures: number;
  resetAt: number;
}

const loginAttempts = new Map<string, LoginAttempt>();

export function createAdminRouter(
  callbacks: AdminCallbacks = {},
): express.Router {
  const { onMessageDeleted, onRoomClosed } = callbacks;
  const router = express.Router();
  const config = loadAdminConfig();
  const secureCookies = process.env.NODE_ENV === "production";
  const cookieName = secureCookies ? "__Host-bma_admin" : "bma_admin";

  router.use(express.json({ limit: "2kb" }));
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  const requireConfigured: RequestHandler = (_request, response, next) => {
    if (config === null) {
      response.status(503).json({ error: "Admin access is not configured" });
      return;
    }

    next();
  };

  const requireSession: RequestHandler = (request, response, next) => {
    if (config === null) {
      response.status(503).json({ error: "Admin access is not configured" });
      return;
    }

    const token = readCookie(request, cookieName);
    const session = token === null
      ? null
      : verifyAdminSession(token, config.sessionSecret);

    if (session === null || session.username !== config.username) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    response.locals.adminSession = session;
    next();
  };

  const requireAdminAction: RequestHandler = (request, response, next) => {
    const session = response.locals.adminSession as AdminSession | undefined;
    const csrfToken = request.get("x-csrf-token");

    if (
      session === undefined ||
      request.get("x-admin-action") !== "1" ||
      csrfToken === undefined ||
      !safeEqualStrings(csrfToken, session.csrfToken) ||
      !hasSameOrigin(request)
    ) {
      response.status(403).json({ error: "Admin action was not authorized" });
      return;
    }

    next();
  };

  router.get("/session", requireConfigured, requireSession, (_request, response) => {
    const session = response.locals.adminSession as AdminSession;

    response.json({
      username: session.username,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  router.post(
    "/login",
    requireConfigured,
    requireSameOrigin,
    (request, response, next) => {
      void handleLogin(
        request,
        response,
        config as AdminConfig,
        cookieName,
        secureCookies,
      ).catch(next);
    },
  );

  router.post(
    "/logout",
    requireConfigured,
    requireSession,
    requireAdminAction,
    (_request, response) => {
      response.clearCookie(cookieName, cookieOptions(secureCookies));
      response.status(204).end();
    },
  );

  router.get(
    "/messages",
    requireConfigured,
    requireSession,
    (request, response) => {
      const before = parseOptionalPositiveInteger(request.query.before);
      const query = typeof request.query.q === "string" ? request.query.q : "";
      const roomId = parseOptionalPositiveInteger(request.query.room);

      if (before === false) {
        response.status(400).json({ error: "Invalid pagination cursor" });
        return;
      }

      if (roomId === false) {
        response.status(400).json({ error: "Invalid room id" });
        return;
      }

      if (query.length > 100) {
        response.status(400).json({ error: "Search must be 100 characters or fewer" });
        return;
      }

      const page = listMessagesForAdmin(
        50,
        before === null ? undefined : before,
        query,
        roomId === null ? undefined : roomId,
      );

      response.json(page);
    },
  );

  router.delete(
    "/messages/:id",
    requireConfigured,
    requireSession,
    requireAdminAction,
    (request, response) => {
      const messageId = Number(request.params.id);

      if (!Number.isSafeInteger(messageId) || messageId <= 0) {
        response.status(400).json({ error: "Invalid message id" });
        return;
      }

      const session = response.locals.adminSession as AdminSession;
      const deletedMessage = deleteMessage(messageId, session.username);

      if (deletedMessage === null) {
        response.status(404).json({ error: "Message not found" });
        return;
      }

      onMessageDeleted?.(deletedMessage.id, deletedMessage.roomId);
      response.json({ deletedMessage });
    },
  );

  router.get(
    "/rooms",
    requireConfigured,
    requireSession,
    (request, response) => {
      const before = parseOptionalPositiveInteger(request.query.before);
      const query = typeof request.query.q === "string" ? request.query.q : "";

      if (before === false) {
        response.status(400).json({ error: "Invalid pagination cursor" });
        return;
      }

      if (query.length > 100) {
        response.status(400).json({ error: "Search must be 100 characters or fewer" });
        return;
      }

      const page = listRoomsForAdmin(
        50,
        before === null ? undefined : before,
        query,
      );

      response.json(page);
    },
  );

  router.delete(
    "/rooms/:id",
    requireConfigured,
    requireSession,
    requireAdminAction,
    (request, response) => {
      const roomId = Number(request.params.id);

      if (!Number.isSafeInteger(roomId) || roomId <= 0) {
        response.status(400).json({ error: "Invalid room id" });
        return;
      }

      const session = response.locals.adminSession as AdminSession;
      const closedRoom = closeRoom(roomId, session.username);

      if (closedRoom === null) {
        const existing = getRoomById(roomId);

        if (existing === null) {
          response.status(404).json({ error: "Room not found" });
          return;
        }

        response.status(400).json({ error: "Permanent rooms cannot be closed" });
        return;
      }

      onRoomClosed?.(roomId);
      response.json({ closedRoom });
    },
  );

  return router;
}

async function handleLogin(
  request: Request,
  response: Response,
  config: AdminConfig,
  cookieName: string,
  secureCookies: boolean,
): Promise<void> {
  const address = request.ip || request.socket.remoteAddress || "unknown";
  const retryAfter = getRetryAfter(address);

  if (retryAfter !== null) {
    response.set("Retry-After", String(retryAfter));
    response.status(429).json({ error: "Too many login attempts" });
    return;
  }

  const username = request.body?.username;
  const password = request.body?.password;

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 100 ||
    password.length > 256
  ) {
    response.status(400).json({ error: "Username and password are required" });
    return;
  }

  recordLoginAttempt(address);
  const passwordMatches = await verifyAdminPassword(password, config.passwordHash);
  const usernameMatches = safeEqualStrings(username, config.username);

  if (!passwordMatches || !usernameMatches) {
    response.status(401).json({ error: "Invalid username or password" });
    return;
  }

  loginAttempts.delete(address);

  const { token, session } = createAdminSession(
    config.username,
    config.sessionSecret,
  );
  response.cookie(cookieName, token, {
    ...cookieOptions(secureCookies),
    maxAge: session.expiresAt - Date.now(),
  });
  response.json({
    username: session.username,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  });
}

function loadAdminConfig(): AdminConfig | null {
  const username = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;

  if (!username || !passwordHash || !sessionSecret || sessionSecret.length < 32) {
    return null;
  }

  return { username, passwordHash, sessionSecret };
}

function cookieOptions(secure: boolean): {
  httpOnly: true;
  sameSite: "strict";
  secure: boolean;
  path: "/";
} {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
  };
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.get("cookie");

  if (cookieHeader === undefined) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const cookieName = cookie.slice(0, separator).trim();

    if (cookieName === name) {
      try {
        return decodeURIComponent(cookie.slice(separator + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function requireSameOrigin(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!hasSameOrigin(request)) {
    response.status(403).json({ error: "Cross-origin request rejected" });
    return;
  }

  next();
}

function parseOptionalPositiveInteger(
  value: unknown,
): number | null | false {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return false;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : false;
}

function getRetryAfter(address: string): number | null {
  const now = Date.now();
  const attempt = loginAttempts.get(address);

  if (attempt === undefined) {
    return null;
  }

  if (attempt.resetAt <= now) {
    loginAttempts.delete(address);
    return null;
  }

  if (attempt.failures < MAX_LOGIN_ATTEMPTS) {
    return null;
  }

  return Math.ceil((attempt.resetAt - now) / 1000);
}

function recordLoginAttempt(address: string): void {
  const now = Date.now();
  const attempt = loginAttempts.get(address);

  if (attempt === undefined || attempt.resetAt <= now) {
    pruneLoginAttempts(now);
    loginAttempts.set(address, {
      failures: 1,
      resetAt: now + LOGIN_WINDOW_MS,
    });
    return;
  }

  attempt.failures += 1;
}

function pruneLoginAttempts(now: number): void {
  for (const [address, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) {
      loginAttempts.delete(address);
    }
  }

  while (loginAttempts.size >= MAX_TRACKED_ADDRESSES) {
    const oldestAddress = loginAttempts.keys().next().value as string | undefined;

    if (oldestAddress === undefined) {
      break;
    }

    loginAttempts.delete(oldestAddress);
  }
}
