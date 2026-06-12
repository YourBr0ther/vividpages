/**
 * Postgres error helpers.
 *
 * drizzle-orm (>= 0.44) wraps driver errors in DrizzleQueryError, putting the
 * original pg error on `error.cause` (possibly nested through further
 * wrappers), so checking `error.code` on the top-level error never matches.
 * These helpers walk the cause chain instead.
 */

const UNIQUE_VIOLATION = '23505'; // Postgres unique_violation

/**
 * True if `error` (or anything in its `cause` chain) is a Postgres
 * unique-constraint violation.
 */
export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
