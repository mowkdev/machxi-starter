import {
  POPULATIONS,
  STAFF_ROLES,
  USER_ROLES,
  type Population,
  type Role,
  type StaffRole,
  type UserRole,
} from "@repo/contracts";
import { createHmac } from "node:crypto";

import { SignJWT, jwtVerify, type JWTHeaderParameters } from "jose";
import { uuidv7 } from "uuidv7";
import { z } from "zod";

import { tokenExpired, tokenInvalid } from "./auth.errors.js";

/**
 * The access token (ADR-0018).
 *
 * `jose` rather than `jsonwebtoken`: ESM-native, no dependencies, and the same
 * API covers the asymmetric keys and the `kid` scheme the future
 * secret-rotation ADR needs — moving from HS256 to EdDSA changes the key, not
 * the call sites.
 *
 * The whole module is one factory over a key ring, so a unit test signs and
 * verifies with its own keys and its own clock without touching config.
 *
 * **The ring** (ADR-0078 §2): a token is signed under the current secret and
 * names it in a `kid` header; verification picks the secret the `kid` names —
 * the current one, or the previous one while a rotation is in flight — and
 * refuses any other. A token with no `kid` is one a release before the ring
 * signed, and is verified under the current secret alone, so a deployment
 * takes the ring without signing anybody out.
 */

/**
 * The `aud` claim, one value per population.
 *
 * This is the second line of defence behind `authenticate(population)`: even
 * if a router were mounted with the wrong guard, a staff token presented on a
 * user route fails audience verification inside `jose` before any of our code
 * looks at it (ADR-0018).
 *
 * **The leading word is the deployment's `APP_ID`** (ADR-0064 §1), which
 * defaults to `machxi` — so `machxi-staff` and `machxi-user` are still what
 * this repository signs. It is deliberately not `JWT_ISSUER`: fusing a token
 * claim with the brand that also names the cookies would make an issuer
 * rotation a sign-out (ADR-0064 §Alternatives).
 */
export const audienceFor = (appId: string, population: Population): string =>
  `${appId}-${population}`;

/** HS256 for v1. Pinned on verification so a token cannot choose its own algorithm. */
const ALGORITHM = "HS256";

/** Roles that exist for each population, for narrowing a verified claim. */
const ROLES_BY_POPULATION = {
  staff: STAFF_ROLES,
  user: USER_ROLES,
} as const satisfies Record<Population, readonly Role[]>;

/**
 * Which role type belongs to which population. It is what makes `verify`
 * hand back `StaffRole[]` on the admin segment and `UserRole[]` on the user
 * one, so no caller needs a cast to put the roles on `ctx.principal`.
 */
export interface RolesOfPopulation {
  readonly staff: StaffRole;
  readonly user: UserRole;
}

/**
 * The claims this API adds on top of the registered ones. `iss`, `aud`, `exp`
 * and `sub` are checked by `jose` itself and are not re-declared here.
 */
const claimsSchema = z.object({
  sub: z.string().min(1),
  pop: z.enum(POPULATIONS),
  sid: z.uuid(),
  // Not `z.enum(...)`: see `narrowRoles`.
  roles: z.array(z.string()),
  exp: z.number(),
  /**
   * RFC 8693's actor claim, present only on an impersonated session
   * (ADR-0057 §4): `act.sub` is the staff member acting **as** `sub`.
   *
   * Optional, and its absence is the ordinary case — every session minted by
   * a password has no actor. It exists so `authenticate` can put both
   * identities on the request without a second lookup (`D13.5`); the session
   * row stays the source of truth, and refresh re-reads it there.
   */
  act: z.object({ sub: z.string().min(1) }).optional(),
});

export interface AccessTokenClaims<P extends Population = Population> {
  /** Principal id. */
  readonly sub: string;
  readonly pop: P;
  /** Session id — what logout and revocation act on. */
  readonly sid: string;
  readonly roles: readonly RolesOfPopulation[P][];
  /** Expiry, in seconds since the epoch. */
  readonly exp: number;
  /**
   * The staff member acting as {@link AccessTokenClaims.sub}, when this
   * session was minted by impersonation (ADR-0057 §4). Absent otherwise, which
   * is every ordinary session.
   */
  readonly act?: { readonly sub: string };
}

/**
 * Keeps only roles the population still has.
 *
 * An unknown value cannot be a forgery — the signature covers the payload —
 * so it means a role was removed from the enum while tokens carrying it were
 * still live. Dropping it can only *reduce* what the bearer may do, whereas
 * rejecting the token would log every affected user out at deploy time for a
 * change that was meant to be additive.
 */
const narrowRoles = <P extends Population>(
  population: P,
  roles: readonly string[],
): readonly RolesOfPopulation[P][] => {
  const known: readonly string[] = ROLES_BY_POPULATION[population];

  return roles.filter((role): role is RolesOfPopulation[P] =>
    known.includes(role),
  );
};

/**
 * The label a key id is derived under. An HMAC under the secret itself, so the
 * `kid` names the key without saying anything about it: a public header value
 * that is a plain digest of the secret would be an offline oracle for it.
 */
const KID_LABEL = "access-token-kid";

/** The key id a secret signs under — 16 base64url characters, stable per secret. */
export const accessKeyId = (secret: string): string =>
  createHmac("sha256", secret)
    .update(KID_LABEL)
    .digest("base64url")
    .slice(0, 16);

/** `jose` reports every failure as an error with a stable `code` string. */
const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

export interface TokenServiceDeps {
  /** `JWT_ACCESS_SECRET` (ADR-0004); at least 32 characters. Signs every token. */
  readonly secret: string;
  /**
   * `JWT_ACCESS_SECRET_PREVIOUS` (ADR-0078 §2): the secret a rotation moved
   * out, still verified for tokens that name it until it is removed — one
   * access-token lifetime later. Never signs.
   */
  readonly previousSecret?: string | undefined;
  /** `APP_ID` (ADR-0064 §1) — the audience's leading word. */
  readonly appId: string;
  readonly issuer: string;
  readonly accessTtlSec: number;
  /** Injected so expiry is testable without sleeping (ADR-0018 §Testability). */
  readonly now?: () => Date;
}

export interface IssueTokenInput {
  readonly principalId: string;
  readonly population: Population;
  readonly sessionId: string;
  readonly roles: readonly Role[];
  /**
   * An upper bound on `exp`, taken from the session's own fixed end
   * (ADR-0057 §4).
   *
   * An impersonated session dies at an instant rotation does not move, and
   * without this cap the last access token issued before that instant would
   * outlive it by up to `JWT_ACCESS_TTL` — a bearer credential for an account
   * nobody is impersonating any more, and one `authenticate`'s session probe
   * would still have to reject rather than never having minted. Omitted, the
   * TTL alone decides, which is every ordinary session.
   */
  readonly notAfter?: Date | undefined;
  /**
   * The staff member acting as `principalId`, written into the RFC 8693 `act`
   * claim (ADR-0057 §4). Omitted on every ordinary session.
   */
  readonly actorId?: string | undefined;
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export const createTokenService = ({
  secret,
  previousSecret,
  appId,
  issuer,
  accessTtlSec,
  now = () => new Date(),
}: TokenServiceDeps) => {
  const encode = (value: string) => new TextEncoder().encode(value);
  const key = encode(secret);
  const kid = accessKeyId(secret);
  // By key id. The previous secret joins only when it is a different key: the
  // schema refuses the two being equal, and a ring of one is the same answer.
  // The current key is set last, so it wins even if the two ids collided.
  const ring = new Map<string, Uint8Array>();

  if (previousSecret !== undefined && previousSecret !== secret) {
    ring.set(accessKeyId(previousSecret), encode(previousSecret));
  }

  ring.set(kid, key);

  /**
   * The key a token's header names. Throwing here is what refuses an unknown
   * `kid`: `jwtVerify` rejects with the thrown error, which `verify` answers
   * as `AUTH_TOKEN_INVALID` like every other failure but expiry.
   */
  const keyFor = (header: JWTHeaderParameters): Uint8Array => {
    if (header.kid === undefined) return key;

    const named = ring.get(header.kid);

    if (named === undefined) throw new Error("unknown key id");

    return named;
  };

  return {
    /**
     * Signs an access token and reports when it dies.
     *
     * `expiresAt` is returned rather than recomputed by the caller so the JWT
     * `exp` and the `accessTokenExpiresAt` on the wire cannot disagree — a
     * client that trusts the field would otherwise retry with a token the
     * server already considers dead.
     */
    issue: async ({
      principalId,
      population,
      sessionId,
      roles,
      notAfter,
      actorId,
    }: IssueTokenInput): Promise<IssuedAccessToken> => {
      const issuedAtSec = Math.floor(now().getTime() / 1000);
      // Floored rather than rounded: a token must never claim a second of life
      // past the session's end, so the cap errs towards the shorter token.
      const expiresAtSec =
        notAfter === undefined
          ? issuedAtSec + accessTtlSec
          : Math.min(
              issuedAtSec + accessTtlSec,
              Math.floor(notAfter.getTime() / 1000),
            );

      const token = await new SignJWT({
        pop: population,
        sid: sessionId,
        roles: [...roles],
        ...(actorId === undefined ? {} : { act: { sub: actorId } }),
      })
        .setProtectedHeader({ alg: ALGORITHM, typ: "JWT", kid })
        .setSubject(principalId)
        .setIssuer(issuer)
        .setAudience(audienceFor(appId, population))
        .setIssuedAt(issuedAtSec)
        .setExpirationTime(expiresAtSec)
        // A unique id per token, so a future denylist or an audit log can name
        // one token rather than one session.
        .setJti(uuidv7())
        .sign(key);

      return { token, expiresAt: new Date(expiresAtSec * 1000) };
    },

    /**
     * Verifies signature, expiry, issuer and the population's audience.
     *
     * @throws AppError `AUTH_TOKEN_EXPIRED` when only `exp` failed — the
     *   client can refresh — and `AUTH_TOKEN_INVALID` for everything else,
     *   which tells it to log in again (ADR-0013).
     */
    verify: async <P extends Population>(
      token: string,
      population: P,
    ): Promise<AccessTokenClaims<P>> => {
      let payload: unknown;

      try {
        ({ payload } = await jwtVerify(token, keyFor, {
          issuer,
          audience: audienceFor(appId, population),
          algorithms: [ALGORITHM],
          currentDate: now(),
        }));
      } catch (error) {
        throw errorCode(error) === "ERR_JWT_EXPIRED"
          ? tokenExpired()
          : tokenInvalid();
      }

      const parsed = claimsSchema.safeParse(payload);

      // A token this API signed always parses. Reaching here means the secret
      // is shared with something that mints a different shape, which is a
      // token we must not act on.
      if (!parsed.success) throw tokenInvalid();

      // Belt and braces over the `aud` check above: both would have to be
      // wrong for a token to cross populations, and the cost is one comparison
      // on a claim we already hold.
      if (parsed.data.pop !== population) throw tokenInvalid();

      return {
        ...(parsed.data.act === undefined ? {} : { act: parsed.data.act }),
        sub: parsed.data.sub,
        // The requested population, not the parsed claim: the line above
        // proved they are equal, and this is the one that carries `P`.
        pop: population,
        sid: parsed.data.sid,
        roles: narrowRoles(population, parsed.data.roles),
        exp: parsed.data.exp,
      };
    },
  } as const;
};

export type TokenService = ReturnType<typeof createTokenService>;
