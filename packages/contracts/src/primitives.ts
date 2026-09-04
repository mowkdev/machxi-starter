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
 *
 * **Lower-cased on the way in**, the way {@link emailSchema} is, and for a
 * sharper reason than tidiness. RFC 9562 says a UUID is written lowercase and
 * read case-insensitively, so `z.uuid()` accepts `018F…` and Postgres's `uuid`
 * type matches it against the stored row — but a service comparing the string
 * to an id it got from somewhere else (a JWT `sub`, a principal) compares
 * *strings*, and those differ. That is not hypothetical: it let an uppercased
 * id walk past `staff.remove`'s self-deletion refusal in D2.4, which is the
 * one rule in that endpoint with no second line of defence.
 *
 * Normalising here fixes the class rather than the instance: every
 * `req.valid.params.id` is canonical before any service sees it.
 */
export const idSchema = z.uuid().toLowerCase();

/** Longest email accepted, per the RFC 5321 path limit. */
export const MAX_EMAIL_LENGTH = 254;

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
  .pipe(z.email().max(MAX_EMAIL_LENGTH));

/** Password policy v1 (ADR-0018): at least 12 characters. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Upper bound on a password. argon2id itself has no meaningful length limit,
 * but an unbounded input is a cheap way to make the server do expensive work
 * (ADR-0020), and 128 characters is far beyond any real passphrase.
 */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * A new password: the v1 policy (ADR-0018). Never trimmed — leading and
 * trailing spaces are legitimate password characters, and silently removing
 * them would lock the user out of an account they can no longer reproduce.
 */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH)
  .max(MAX_PASSWORD_LENGTH);

/**
 * A password being *presented* for verification (login, change-password).
 *
 * Deliberately **not** {@link passwordSchema}: applying the policy here would
 * answer "is this password long enough to be one of ours?" with a `400` before
 * any credential check, which both leaks the policy and turns a wrong-password
 * `401` into a different status. It only bounds the work (ADR-0020).
 */
export const presentedPasswordSchema = z
  .string()
  .min(1)
  .max(MAX_PASSWORD_LENGTH);

/** Longest accepted person name component. */
export const MAX_NAME_LENGTH = 100;

/** A first or last name: trimmed, non-empty, bounded. */
export const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

/**
 * Slug bounds (ADR-0067 §2). The lower bound keeps a slug typeable and
 * memorable rather than a single letter; the upper is a DNS label, which is
 * the shape a slug is most likely to end up in one day (`acme.example.com`)
 * and costs nothing to respect now.
 */
export const MIN_SLUG_LENGTH = 2;
export const MAX_SLUG_LENGTH = 63;

/**
 * The pattern a slug must match: lower-case letters, digits and single inner
 * hyphens.
 *
 * Anchored, and written as one expression rather than a chain of `.refine`s so
 * the failure is one message rather than three. A leading or trailing hyphen
 * and a doubled hyphen are all excluded by construction: the body is
 * `[a-z0-9]` groups joined by exactly one `-`.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Prefixes a user may not choose, because the system derives slugs with them.
 *
 * `personal-` is the derivation every personal organization's slug uses
 * (ADR-0067 §2), and the collision would not fail loudly: a create takes the
 * partial unique index as its `onConflictDoNothing` target and then reads the
 * row back filtering `kind = 'personal'`, so a squatted slug would make a
 * personal organization **silently not exist** — the one invariant the whole
 * record rests on, broken with no error and no log line. Guessing a victim's
 * UUIDv7 is not feasible, so this is robustness rather than a live attack; it
 * costs one rule, and it also stops a `team` organization from posing as
 * somebody's personal one in a pasted link.
 */
export const RESERVED_SLUG_PREFIXES = ["personal-"] as const;

/**
 * An organization's URL name (ADR-0067 §2, §6).
 *
 * Trimmed and lower-cased before validation, the way {@link emailSchema} is:
 * the column is `citext` so uniqueness is already case-insensitive, and
 * normalising here keeps the *stored* value canonical so a link built from a
 * row is the same link every time.
 *
 * It is the customer app's URL segment — `/orgs/$orgSlug` — which is why the
 * pattern is this narrow: anything that needs percent-encoding to appear in a
 * path is a slug that reads differently in the address bar than in the
 * database.
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(MIN_SLUG_LENGTH)
      .max(MAX_SLUG_LENGTH)
      /*
       * No message of its own, on purpose (ADR-0046 §6). A schema-level
       * `error` wins over every map a client can install, so a sentence here
       * would be the one field rule in this package an operator cannot read
       * in their own language. The bare `.regex()` raises a generic
       * `invalid_format` issue, which zod's own locale map already speaks.
       */
      .regex(SLUG_PATTERN)
      /*
       * Keyless like the rule above, and for the same reason (ADR-0046 §6): a
       * schema-level `error` beats every locale map a client can install.
       */
      .refine(
        (value) =>
          !RESERVED_SLUG_PREFIXES.some((prefix) => value.startsWith(prefix)),
      ),
  );
