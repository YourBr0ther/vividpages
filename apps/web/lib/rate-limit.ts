/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * Each key gets a counter that resets `windowMs` after its first hit (a fixed
 * window, not a sliding window or token bucket: a burst right at the window
 * boundary can briefly see up to 2x `max`).
 *
 * NOTE: state is per-replica and resets on restart — good enough for a
 * self-hosted single-instance deployment; replace with a shared store (Redis)
 * if the web app is ever scaled horizontally.
 *
 * Callers that key by IP read `x-forwarded-for`, which is trusted here because
 * Traefik fronts the app and overwrites the header.
 */
export function createFixedWindowLimiter({
  windowMs,
  max,
}: {
  windowMs: number;
  max: number;
}) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function sweep(now: number) {
    // Opportunistic cleanup so the map doesn't grow unboundedly.
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }
  }

  return {
    /** Record a hit for `key`; returns true if the key is now over the limit. */
    hit(key: string): boolean {
      const now = Date.now();
      sweep(now);
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return false;
      }
      bucket.count += 1;
      return bucket.count > max;
    },
    /** True if `key` is currently over the limit (does not record a hit). */
    isLimited(key: string): boolean {
      const bucket = buckets.get(key);
      return Boolean(
        bucket && bucket.resetAt > Date.now() && bucket.count >= max,
      );
    },
    /** Clear the bucket for `key` (e.g. after a successful login). */
    reset(key: string): void {
      buckets.delete(key);
    },
  };
}
