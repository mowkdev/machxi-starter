import { createHash, hkdfSync, timingSafeEqual } from "node:crypto";

import { LOCALES, type Locale } from "@repo/contracts";
import { sha256Base64url } from "@repo/crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";

import type { OidcAuthorizationRequest } from "./oidc.types.js";

/**
 * The transaction between a sign-in's start and its callback (ADR-0072 §2).
 *
 * Carried in the `__Host-<APP_ID>.oidc` cookie and nowhere else, as a compact
 * HS256 JWT signed with `jose` under a key of its own (ADR-0078 §2):
 * `OIDC_TRANSACTION_SECRET`, or — unset — a key derived from
 * `JWT_ACCESS_SECRET` under a label of its own. **Signed, not
 * encrypted, on purpose**: nothing in it is a secret from the browser that
 * owns it — the verifier is worthless without the authorization code Google
 * hands that same browser — and what the signature buys is that the API reads
 * back exactly what it wrote. `__Host-` keeps every other origin from writing
 * one.
 *
 * **The audience is `<APP_ID>-oidc`**, beside the access token's
 * `<APP_ID>-staff` and `<APP_ID>-user` (ADR-0064 §1). Until `D29.2` the key
 * was the access tokens' and the audience alone kept the two kinds apart; the
 * key is now the codec's own, so the separation is structural and the pinned
 * audience is the second line rather than the only one. An access token
 * presented as a transaction fails the signature and `aud`, and the reverse
 * fails both too.
 *
 * A database row keyed by `state` was the alternative, and ADR-0072
 * §Alternatives says why not: nothing would bind the callback to the browser
 * that started, which is the login-CSRF case this cookie exists to close.
 */

/**
 * How long a sign-in may take between the click and the return from the
 * provider — the cookie's `Max-Age` and the token's `exp` (ADR-0072 §2).
 */
export const OIDC_TRANSACTION_TTL_SEC = 10 * 60;

/**
 * The HKDF label the codec's key is derived under when
 * `OIDC_TRANSACTION_SECRET` is unset. Changing it is a key rotation: every
 * sign-in in flight at deploy fails its callback once.
 */
const DERIVED_KEY_INFO = "oidc-transaction-key-v1";

/**
 * The codec's key when no secret of its own is configured (ADR-0078 §2): HKDF
 * over the access secret under a label of its own, so the two never share a
 * key even in a default clone, and a deployment that states
 * `OIDC_TRANSACTION_SECRET` rotates the two independently.
 */
export const deriveOidcTransactionSecret = (accessSecret: string): string =>
  Buffer.from(
    hkdfSync("sha256", accessSecret, "", DERIVED_KEY_INFO, 32),
  ).toString("base64url");

/**
 * The codec's key: its own secret when stated, derived otherwise. One
 * function, so the composition root cannot hand the codec the access secret.
 */
export const oidcTransactionSecret = ({
  transactionSecret,
  accessSecret,
}: {
  readonly transactionSecret: string | undefined;
  readonly accessSecret: string;
}): string => transactionSecret ?? deriveOidcTransactionSecret(accessSecret);

/** Pinned on verification, so a transaction cannot choose its own algorithm. */
const ALGORITHM = "HS256";

/**
 * What a round trip is for: a **sign-in** from the public start (ADR-0072
 * §2), or a **link** from the authenticated one on the profile (§3, built at
 * `D19.4`).
 */
export type OidcIntent = "signin" | "link";

/** What every transaction carries, whichever start sealed it. */
interface OidcTransactionBase extends OidcAuthorizationRequest {
  /**
   * The SPA's language at the start, when it said (ADR-0072 §2). Carried for
   * whatever the callback needs to write in the reader's language; absent
   * means the SPA did not say.
   */
  readonly locale: Locale | undefined;
}

/**
 * What the start wrote and the callback reads back — discriminated on the
 * intent, so a link's account and session exist exactly when the intent says
 * the callback is linking.
 *
 * A **link** carries the account that asked and the **session** it asked
 * from (ADR-0072 §3, amended at `D19.4`): the callback is a navigation from
 * Google with no bearer token on it, so the transaction is the only thing that
 * can say whose account the identity joins — and the session is what lets the
 * callback refuse a link whose session was ended in the minutes between,
 * which is exactly what a password reset does to an account being recovered
 * from somebody.
 */
export type OidcTransaction =
  | (OidcTransactionBase & { readonly intent: "signin" })
  | (OidcTransactionBase & {
      readonly intent: "link";
      readonly userId: string;
      readonly sessionId: string;
    });

/**
 * The claims, read back after the signature, issuer, audience and expiry have
 * verified. Short names because the whole thing rides in a cookie on every
 * request to this host for ten minutes.
 */
const claimsBase = {
  k: z.literal("tx"),
  st: z.string().min(1),
  nn: z.string().min(1),
  cv: z.string().min(1),
  lc: z.enum(LOCALES).optional(),
} as const;

const claimsSchema = z.discriminatedUnion("in", [
  z.object({ ...claimsBase, in: z.literal("signin") }),
  z.object({
    ...claimsBase,
    in: z.literal("link"),
    // The account and the session a link was asked from (ADR-0072 §3).
    uid: z.string().min(1),
    sid: z.string().min(1),
  }),
]);

/**
 * The **handoff binding** the callback leaves in the same cookie after a
 * successful sign-in (ADR-0072 §2, amended at `D19.2`): the SHA-256 of the
 * handoff token it put in the fragment, and nothing else.
 *
 * The transaction binds the *callback* to the browser that started; this binds
 * the *exchange* to the browser the callback answered. Without it the
 * sixty-second token is a bearer credential anybody can relay: an attacker
 * runs the flow in their own browser, lifts `#token=` from the redirect, and
 * sends a victim to the landing route, which signs a browser with no session
 * into the attacker's account (`D19.2`'s `security-reviewer`). The `k` claim
 * keeps the two kinds apart, so a transaction presented at the exchange, or a
 * binding presented at the callback, opens to nothing.
 */
const handoffClaimsSchema = z.object({
  k: z.literal("handoff"),
  hh: z.string().min(1),
});

/** Equal-length digests compared in constant time. */
const sameDigest = (a: string, b: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );

export interface OidcTransactionCodecDeps {
  /** The codec's own key — {@link oidcTransactionSecret}, never the access token's. */
  readonly secret: string;
  /** `APP_ID` (ADR-0064 §1) — the audience's leading word. */
  readonly appId: string;
  /** `JWT_ISSUER`, the same issuer every token this API signs carries. */
  readonly issuer: string;
  readonly ttlSec?: number;
  /** Injected so expiry is testable without sleeping (ADR-0018 §Testability). */
  readonly now?: () => Date;
}

export interface OidcTransactionCodec {
  /** The cookie's `Max-Age`, in seconds — the same window the token's `exp` sets. */
  readonly ttlSec: number;
  readonly seal: (transaction: OidcTransaction) => Promise<string>;
  /**
   * The transaction, or `undefined` for anything that is not one this API
   * sealed in the last {@link ttlSec} seconds — wrong key, wrong audience,
   * wrong issuer, expired, malformed or absent. **Never rejects**: the caller
   * is the callback, which answers every refusal with the same redirect.
   */
  readonly open: (
    value: string | undefined,
  ) => Promise<OidcTransaction | undefined>;
  /**
   * Seals the binding for one handoff token, good for `ttlSec` — the
   * handoff's own window, so the cookie and the token die together.
   */
  readonly sealHandoff: (token: string, ttlSec: number) => Promise<string>;
  /**
   * Whether `value` is a binding this API sealed, still live, for exactly
   * this token. **Never rejects**; anything else is `false`.
   */
  readonly bindsHandoff: (
    value: string | undefined,
    token: string,
  ) => Promise<boolean>;
}

export const createOidcTransactionCodec = ({
  secret,
  appId,
  issuer,
  ttlSec = OIDC_TRANSACTION_TTL_SEC,
  now = () => new Date(),
}: OidcTransactionCodecDeps): OidcTransactionCodec => {
  const key = new TextEncoder().encode(secret);
  const audience = `${appId}-oidc`;

  const sign = (claims: JWTPayload, lifetimeSec: number): Promise<string> => {
    const issuedAt = Math.floor(now().getTime() / 1000);

    return new SignJWT(claims)
      .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + lifetimeSec)
      .sign(key);
  };

  /** The verified payload, or `undefined` — never a rejection. */
  const verify = async (
    value: string | undefined,
  ): Promise<JWTPayload | undefined> => {
    if (value === undefined || value === "") return undefined;

    try {
      const { payload } = await jwtVerify(value, key, {
        issuer,
        audience,
        algorithms: [ALGORITHM],
        currentDate: now(),
        requiredClaims: ["exp", "iat"],
      });

      return payload;
    } catch {
      return undefined;
    }
  };

  return {
    ttlSec,

    seal: (transaction) =>
      sign(
        {
          k: "tx",
          st: transaction.state,
          nn: transaction.nonce,
          cv: transaction.codeVerifier,
          in: transaction.intent,
          ...(transaction.intent === "link"
            ? { uid: transaction.userId, sid: transaction.sessionId }
            : {}),
          ...(transaction.locale === undefined
            ? {}
            : { lc: transaction.locale }),
        },
        ttlSec,
      ),

    open: async (value) => {
      const claims = claimsSchema.safeParse(await verify(value));

      if (!claims.success) return undefined;

      const base = {
        state: claims.data.st,
        nonce: claims.data.nn,
        codeVerifier: claims.data.cv,
        locale: claims.data.lc,
      };

      return claims.data.in === "link"
        ? {
            ...base,
            intent: "link",
            userId: claims.data.uid,
            sessionId: claims.data.sid,
          }
        : { ...base, intent: "signin" };
    },

    sealHandoff: (token, lifetimeSec) =>
      sign({ k: "handoff", hh: sha256Base64url(token) }, lifetimeSec),

    bindsHandoff: async (value, token) => {
      const claims = handoffClaimsSchema.safeParse(await verify(value));

      return (
        claims.success && sameDigest(claims.data.hh, sha256Base64url(token))
      );
    },
  };
};
