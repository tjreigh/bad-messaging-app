interface RateLimitOptions {
  max: number;
  windowMs: number;
  maxTrackedKeys: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  consume(key: string): boolean;
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { max, windowMs, maxTrackedKeys } = options;
  const buckets = new Map<string, Bucket>();

  return {
    consume(key: string): boolean {
      const now = Date.now();
      let bucket = buckets.get(key);

      if (bucket === undefined || bucket.resetAt <= now) {
        pruneExpired(buckets, now);
        evictIfNeeded(buckets, maxTrackedKeys);
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return max >= 1;
      }

      bucket.count += 1;
      return bucket.count <= max;
    },
  };
}

function pruneExpired(buckets: Map<string, Bucket>, now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function evictIfNeeded(buckets: Map<string, Bucket>, maxTrackedKeys: number): void {
  while (buckets.size >= maxTrackedKeys) {
    const oldestKey = buckets.keys().next().value;

    if (oldestKey === undefined) {
      break;
    }

    buckets.delete(oldestKey);
  }
}
