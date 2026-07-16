import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_COST = 2 ** 15;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 3;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

export interface AdminSession {
  username: string;
  csrfToken: string;
  expiresAt: number;
}

interface StoredSession extends AdminSession {
  version: 1;
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, {
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  });

  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyAdminPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parsedHash = parsePasswordHash(encodedHash);

  if (parsedHash === null) {
    return false;
  }

  const derivedKey = await deriveKey(password, parsedHash.salt, parsedHash);

  return safeEqual(derivedKey, parsedHash.derivedKey);
}

export function createAdminSession(
  username: string,
  sessionSecret: string,
  now = Date.now(),
): { token: string; session: AdminSession } {
  const session: AdminSession = {
    username,
    csrfToken: randomBytes(24).toString("base64url"),
    expiresAt: now + SESSION_LIFETIME_MS,
  };
  const storedSession: StoredSession = { version: 1, ...session };
  const payload = Buffer.from(JSON.stringify(storedSession)).toString("base64url");
  const signature = sign(payload, sessionSecret);

  return {
    token: `${payload}.${signature}`,
    session,
  };
}

export function verifyAdminSession(
  token: string,
  sessionSecret: string,
  now = Date.now(),
): AdminSession | null {
  const [payload, suppliedSignature, extra] = token.split(".");

  if (!payload || !suppliedSignature || extra !== undefined) {
    return null;
  }

  const expectedSignature = sign(payload, sessionSecret);

  if (!safeEqual(Buffer.from(suppliedSignature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<StoredSession>;

    if (
      session.version !== 1 ||
      typeof session.username !== "string" ||
      session.username.length === 0 ||
      typeof session.csrfToken !== "string" ||
      session.csrfToken.length < 32 ||
      typeof session.expiresAt !== "number" ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= now
    ) {
      return null;
    }

    return {
      username: session.username,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    };
  } catch {
    return null;
  }
}

export function safeEqualStrings(left: string, right: string): boolean {
  return safeEqual(Buffer.from(left), Buffer.from(right));
}

function sign(payload: string, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret)
    .update(payload)
    .digest("base64url");
}

function parsePasswordHash(encodedHash: string): {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: Buffer;
  derivedKey: Buffer;
} | null {
  const [algorithm, cost, blockSize, parallelization, salt, derivedKey, extra] =
    encodedHash.split("$");
  const parsedCost = Number(cost);
  const parsedBlockSize = Number(blockSize);
  const parsedParallelization = Number(parallelization);

  if (
    algorithm !== "scrypt" ||
    extra !== undefined ||
    parsedCost !== SCRYPT_COST ||
    parsedBlockSize !== SCRYPT_BLOCK_SIZE ||
    parsedParallelization !== SCRYPT_PARALLELIZATION ||
    !salt ||
    !derivedKey
  ) {
    return null;
  }

  try {
    const saltBuffer = Buffer.from(salt, "base64url");
    const derivedKeyBuffer = Buffer.from(derivedKey, "base64url");

    if (saltBuffer.length !== 16 || derivedKeyBuffer.length !== SCRYPT_KEY_LENGTH) {
      return null;
    }

    return {
      cost: parsedCost,
      blockSize: parsedBlockSize,
      parallelization: parsedParallelization,
      salt: saltBuffer,
      derivedKey: derivedKeyBuffer,
    };
  } catch {
    return null;
  }
}

function deriveKey(
  password: string,
  salt: Buffer,
  options: { cost: number; blockSize: number; parallelization: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: options.cost,
        r: options.blockSize,
        p: options.parallelization,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
