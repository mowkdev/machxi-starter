import { z } from "zod";

/**
 * Field-level schemas reused across request bodies, so that "what a valid
 * email is" and "what a valid password is" are decided once (ADR-0011).
 */

/**
 * An ISO-8601 UTC timestamp string, the wire form of every date (ADR-0012).
 * Kept as an alias rather than a branded type so resource types read plainly
 * and clients can hand the value straight to `new Date(...)`.
 */
export type IsoDateTime = string;

/**
 * A resource id. UUIDs are generated as v7 (ADR-0006), but the schema accepts
 * any version: rejecting a well-formed id because of its version would turn a
 * future id-strategy change into a breaking API change for no safety gain.
 */
export const idSchema = z.uuid();

/** Longest email accepted, per the RFC 5321 path limit. */
export const maxEmailLength = 254;

/**
 * An email address, trimmed and lower-cased before validation.
 *
 * Normalising on the way in keeps stored values canonical; uniqueness itself
 * is enforced by the `citext` column (ADR-0017), so this is convenience, not
 * the integrity guarantee.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(maxEmailLength));

/** Password policy v1 (ADR-0018): at least 12 characters. */
export const minPasswordLength = 12;

/**
 * Upper bound on a password. argon2id itself has no meaningful length limit,
 * but an unbounded input is a cheap way to make the server do expensive work
 * (ADR-0020), and 128 characters is far beyond any real passphrase.
 */
export const maxPasswordLength = 128;

/**
 * A new password: the v1 policy (ADR-0018). Never trimmed — leading and
 * trailing spaces are legitimate password characters, and silently removing
 * them would lock the user out of an account they can no longer reproduce.
 */
export const passwordSchema = z
  .string()
  .min(minPasswordLength)
  .max(maxPasswordLength);

/**
 * A password being *presented* for verification (login, change-password).
 *
 * Deliberately **not** {@link passwordSchema}: applying the policy here would
 * answer "is this password long enough to be one of ours?" with a `400` before
 * any credential check, which both leaks the policy and turns a wrong-password
 * `401` into a different status. It only bounds the work (ADR-0020).
 */
export const presentedPasswordSchema = z.string().min(1).max(maxPasswordLength);

/** Longest accepted person name component. */
export const maxNameLength = 100;

/** A first or last name: trimmed, non-empty, bounded. */
export const nameSchema = z.string().trim().min(1).max(maxNameLength);
