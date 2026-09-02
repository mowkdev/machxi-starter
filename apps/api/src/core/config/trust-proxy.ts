/**
 * `TRUST_PROXY`, resolved (ADR-0004, ADR-0020, and ADR-0059 §7 for the
 * production refusal).
 *
 * A module of its own since `D14.3`, and only because the production guard had
 * to move from comparing the raw string to comparing what Express will
 * actually be given: `schema.ts` needs this function and `config.ts` imports
 * `schema.ts`, so it cannot live in `config.ts` any more. Both import it here.
 */

/** What Express accepts for its `trust proxy` setting. */
export type TrustProxy = boolean | number | string;

/**
 * Interprets `TRUST_PROXY`. Express itself accepts three forms, so the
 * variable stays a string in the schema and is resolved once, here:
 * `false`/`true`, a hop count, or a value Express parses itself
 * (`loopback`, a CIDR list).
 */
export const toTrustProxy = (raw: string): TrustProxy => {
  const value = raw.trim();

  if (value === "false") return false;
  if (value === "true") return true;

  const hops = Number(value);

  return Number.isInteger(hops) && hops >= 0 ? hops : value;
};

/**
 * The settings a production deployment may not use, as **resolved values**.
 *
 * `false` and `0` are the same instruction to Express — trust nothing — and
 * `""` resolves to `0`, which is what an unset variable becomes the moment it
 * passes through a compose file's `TRUST_PROXY=${TRUST_PROXY}`. Comparing the
 * raw string would refuse `"false"` and wave all three of the others through,
 * which is the whole failure ADR-0059 §7 is about: behind a reverse proxy
 * every request then reports the proxy's address as `req.ip`, so the login
 * limiter, the refresh limiter and the audit trail collapse onto one key —
 * silently, and in the permissive direction.
 *
 * `true` is refused for the opposite reason (ADR-0020): Express then takes the
 * left-most `X-Forwarded-For` entry verbatim and `req.ip` becomes
 * attacker-controlled.
 */
export const isProductionTrustProxy = (raw: string): boolean => {
  const value = toTrustProxy(raw);

  return value !== true && value !== false && value !== 0;
};
