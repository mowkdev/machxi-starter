/**
 * Duration strings (`15m`, `30d`) → seconds (ADR-0004).
 *
 * `JWT_ACCESS_TTL` and `REFRESH_TOKEN_TTL` are written the way an operator
 * thinks about them, but every consumer needs a number: the JWT's `exp`, the
 * `accessTokenExpiresAt` field of the response and the session's
 * `refresh_token_expires_at` all have to come from the *same* number, or a
 * client's idea of when its token dies differs from the server's.
 *
 * Parsing happens in the config schema so an unparseable value is a startup
 * failure. The alternative — resolving it lazily inside the token service —
 * turns a typo into a 500 on the first login of a deployment, which is the
 * worst possible moment to discover it (ADR-0004 §validate where you read).
 */

/** Seconds per accepted unit. Deliberately no month or year: both are ambiguous. */
const UNIT_SECONDS: Readonly<Record<string, number>> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

/** One year. A TTL beyond this is a typo (`30dd` cannot happen, but `3000d` can). */
export const MAX_DURATION_SECONDS = 365 * 86400;

/**
 * Parses `<positive integer><s|m|h|d>` into seconds.
 *
 * @returns the number of seconds, or `null` when the value is not a duration
 *   in that form, is zero, or exceeds {@link MAX_DURATION_SECONDS}. The caller
 *   is a zod `.refine`/`.transform` pair, which turns `null` into the offending
 *   key and its constraint — never the value itself (ADR-0004).
 */
export const parseDurationSeconds = (value: string): number | null => {
  const match = DURATION_PATTERN.exec(value.trim());

  if (match === null) return null;

  const [, amount, unit] = match;
  // Both are non-optional captures of a matched pattern; the guard is for the
  // type checker, not for a case that can occur.
  if (amount === undefined || unit === undefined) return null;

  const seconds = Number(amount) * (UNIT_SECONDS[unit] ?? 0);

  if (seconds <= 0 || seconds > MAX_DURATION_SECONDS) return null;

  return seconds;
};
