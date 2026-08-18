import {
  POPULATIONS,
  STAFF_ROLES,
  USER_ROLES,
  type Population,
  type Role,
  type StaffRole,
  type UserRole,
} from "@repo/contracts";
import { SignJWT, jwtVerify } from "jose";
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
 * The whole module is one factory over a secret, so a unit test signs and
 * verifies with its own key and its own clock without touching config.
 */

/**
 * The `aud` claim, one value per population.
 *
 * This is the second line of defence behind `authenticate(population)`: even
 * if a router were mounted with the wrong guard, a staff token presented on a
 * user route fails audience verification inside `jose` before any of our code
 * looks at it (ADR-0018).
 */
export const audienceFor = (population: Population): string =>
  `machxi-${population}`;

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

/** `jose` reports every failure as an error with a stable `code` string. */
const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

export interface TokenServiceDeps {
  /** `JWT_ACCESS_SECRET` (ADR-0004); at least 32 characters. */
  readonly secret: string;
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
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export const createTokenService = ({
  secret,
  issuer,
  accessTtlSec,
  now = () => new Date(),
}: TokenServiceDeps) => {
  const key = new TextEncoder().encode(secret);

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
    }: IssueTokenInput): Promise<IssuedAccessToken> => {
      const issuedAtSec = Math.floor(now().getTime() / 1000);
      const expiresAtSec = issuedAtSec + accessTtlSec;

      const token = await new SignJWT({
        pop: population,
        sid: sessionId,
        roles: [...roles],
      })
        .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
        .setSubject(principalId)
        .setIssuer(issuer)
        .setAudience(audienceFor(population))
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
        ({ payload } = await jwtVerify(token, key, {
          issuer,
          audience: audienceFor(population),
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
