import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { z } from "zod";

import type { RequestContext } from "../context/index.js";
import { buildAuthorizationUrl } from "./authorization.js";
import type {
  OidcAuthorizationRequest,
  OidcExchangeInput,
  OidcExchangeResult,
  OidcFailureReason,
  OidcIdentity,
  OidcProvider,
} from "./oidc.types.js";

/**
 * Google's OpenID Connect issuer, and the base its discovery document is
 * published under (`/.well-known/openid-configuration`).
 */
export const GOOGLE_ISSUER = "https://accounts.google.com";

/**
 * The second spelling of Google's issuer. Google documents that `iss` in its
 * ID tokens is `accounts.google.com` **or** `https://accounts.google.com`, so
 * refusing the bare host would refuse genuine tokens. Accepted for Google's
 * own issuer only — an issuer passed in for a stub or another provider gets
 * exactly the value its discovery document states.
 */
const GOOGLE_ISSUER_ALIAS = "accounts.google.com";

/**
 * How long any one request to the provider may take: discovery, the token
 * endpoint, and the key set (which `jose` times out itself at this value).
 * The callback is a person waiting on a redirect; a provider that has not
 * answered in five seconds is answered with an error, not waited on.
 */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Leeway on `exp` and `nbf`, in seconds. Two machines' clocks disagree by a
 * little, and a token that expired half a minute ago by our clock was valid by
 * the issuer's when it was minted; this bounds that disagreement rather than
 * pretending it is zero.
 */
const DEFAULT_CLOCK_TOLERANCE_SEC = 30;

/**
 * What discovery must say. `https` only: these are the URLs the API sends the
 * client secret to and fetches the signing keys from, and a document naming a
 * plain-http endpoint is one the API refuses to believe.
 */
const discoverySchema = z.object({
  issuer: z.string().min(1),
  authorization_endpoint: z.url({ protocol: /^https$/ }),
  token_endpoint: z.url({ protocol: /^https$/ }),
  jwks_uri: z.url({ protocol: /^https$/ }),
});

type Discovery = z.infer<typeof discoverySchema>;

/** The one field of the token response the flow reads; the access token is never kept. */
const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

/**
 * The addresses Google hosts outright: for these, `email_verified` means the
 * person controls the mailbox now (ADR-0072 §1, amended at `D19.1`).
 */
const GOOGLE_HOSTED_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
];

/**
 * The claims a **verified** ID token must carry to be an identity.
 *
 * `sub` is the only one whose absence refuses the token. Every other claim
 * falls back to `undefined` when it is missing or malformed — `email` when it
 * is not an address, `email_verified` when it is neither Google's boolean nor
 * the string it has historically sent, `hd` when it is not a string — so a bad
 * claim reads as "no verified address", which never matches an account and
 * never creates one (ADR-0072 §1), rather than as a refused sign-in with a
 * misleading reason. (`D19.1`'s `code-reviewer`.)
 */
const claimsSchema = z.object({
  sub: z.string().min(1),
  nonce: z.string().optional().catch(undefined),
  azp: z.string().optional().catch(undefined),
  aud: z.union([z.string(), z.array(z.string())]),
  email: z.email().optional().catch(undefined),
  email_verified: z
    .union([z.boolean(), z.string()])
    .optional()
    .catch(undefined),
  /** Google Workspace's hosted domain; absent for a consumer account. */
  hd: z.string().min(1).optional().catch(undefined),
  given_name: z.string().min(1).optional().catch(undefined),
  family_name: z.string().min(1).optional().catch(undefined),
});

/**
 * Whether Google is authoritative for `email` (ADR-0072 §1, amended at
 * `D19.1`): it hosts the mailbox, as a consumer address or as a Workspace
 * domain named by the token's own `hd`. Google's documented rule; anywhere
 * else it checked the mailbox once, when the Google account was made.
 */
const googleIsAuthoritativeFor = (
  email: string,
  hostedDomain: string | undefined,
): boolean => {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();

  return (
    GOOGLE_HOSTED_DOMAINS.includes(domain) ||
    (hostedDomain !== undefined && hostedDomain.toLowerCase() === domain)
  );
};

export interface GoogleOidcProviderDeps {
  readonly clientId: string;
  readonly clientSecret: string;
  /**
   * `${API_PUBLIC_URL}/api/v1/public/auth/google/callback` — composed once by
   * the caller and registered, exactly, in the provider's console.
   */
  readonly redirectUri: string;
  /**
   * Defaults to Google's. The test suite passes a stubbed issuer with its own
   * keys, which is the only place anything but Google is ever named here.
   */
  readonly issuer?: string;
  /** Defaults to the global `fetch`; the stubbed issuer's is injected in tests. */
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
  readonly clockToleranceSec?: number;
  /** The clock `exp` is judged against; injected for the same reason `now` is elsewhere. */
  readonly now?: () => Date;
}

/**
 * The Google adapter behind {@link OidcProvider} (ADR-0072 §2): discovery,
 * PKCE `S256`, the authorization-code exchange with the client secret, and the
 * ID token verified with `jose` against the issuer's published keys — `iss`,
 * `aud`, `exp`, the algorithm, then `nonce` and `azp` by hand.
 *
 * **Discovery is cached** for the life of the process once it succeeds, and a
 * failure is not cached: the next attempt tries again rather than inheriting
 * an outage. The signing keys are cached by `jose`'s remote key set, which
 * refetches on an unknown `kid` — which is how a key rotation at Google is
 * absorbed without a restart.
 *
 * Nothing secret is logged: the client secret, the verifier, the code and the
 * ID token stay in locals, and the refusal line carries the reason and, for a
 * `jose` failure, its error code.
 */
export const createGoogleOidcProvider = ({
  clientId,
  clientSecret,
  redirectUri,
  issuer = GOOGLE_ISSUER,
  fetch: fetchImpl = (input, init) => globalThis.fetch(input, init),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  clockToleranceSec = DEFAULT_CLOCK_TOLERANCE_SEC,
  now = () => new Date(),
}: GoogleOidcProviderDeps): OidcProvider => {
  const acceptedIssuers =
    issuer === GOOGLE_ISSUER ? [GOOGLE_ISSUER, GOOGLE_ISSUER_ALIAS] : [issuer];

  const loadDiscovery = async () => {
    // `reply`, not `response`: the lint rule that keeps controllers on
    // `respond.*` reads any `response.json()` as a raw body (ADR-0012).
    const reply = await fetchImpl(
      `${issuer}/.well-known/openid-configuration`,
      {
        headers: { accept: "application/json" },
        // A redirect away from the issuer's own origin is not a document the
        // issuer published; follow nothing.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      },
    );

    if (!reply.ok) {
      throw new Error(
        `OIDC discovery answered ${String(reply.status)} for ${issuer}`,
      );
    }

    const document: Discovery = discoverySchema.parse(await reply.json());

    // OIDC Discovery §4.3: the document's issuer must be the one it was
    // fetched for, or it describes somebody else.
    if (document.issuer !== issuer) {
      throw new Error(`OIDC discovery for ${issuer} names another issuer`);
    }

    return {
      document,
      keys: createRemoteJWKSet(new URL(document.jwks_uri), {
        timeoutDuration: timeoutMs,
        [customFetch]: fetchImpl,
      }),
    } as const;
  };

  let discovery: ReturnType<typeof loadDiscovery> | undefined;

  const discover = () => {
    discovery ??= loadDiscovery().catch((error: unknown) => {
      // Not cached: an outage now must not become an outage for the life of
      // the process.
      discovery = undefined;
      throw error;
    });

    return discovery;
  };

  const refuse = (
    ctx: RequestContext,
    reason: OidcFailureReason,
    detail?: string,
  ): OidcExchangeResult => {
    ctx.logger.warn(
      {
        provider: "google",
        reason,
        ...(detail === undefined ? {} : { detail }),
      },
      "oidc exchange refused",
    );

    return { ok: false, reason };
  };

  /** A `jose` error code, or `undefined` for anything else that was thrown. */
  const joseCodeOf = (error: unknown): string | undefined => {
    const code = (error as { code?: unknown } | null)?.code;

    return typeof code === "string" && code.startsWith("ERR_")
      ? code
      : undefined;
  };

  /**
   * Which of the two a verification failure is. The key set not answering —
   * a timeout, a non-200, a body that is not a key set, a network error — is
   * the provider's outage; everything else `jose` refuses is the token's
   * fault.
   */
  const verificationFailure = (code: string | undefined): OidcFailureReason =>
    code === undefined ||
    code === "ERR_JWKS_TIMEOUT" ||
    code === "ERR_JWKS_INVALID" ||
    code === "ERR_JOSE_GENERIC"
      ? "provider_unreachable"
      : "id_token_invalid";

  return {
    id: "google",

    authorizationUrl: async (
      _ctx: RequestContext,
      request: OidcAuthorizationRequest,
    ): Promise<string> => {
      const { document } = await discover();

      return buildAuthorizationUrl(document.authorization_endpoint, {
        clientId,
        redirectUri,
        request,
      });
    },

    exchangeCode: async (
      ctx: RequestContext,
      { code, codeVerifier, nonce }: OidcExchangeInput,
    ): Promise<OidcExchangeResult> => {
      let resolved: Awaited<ReturnType<typeof loadDiscovery>>;

      try {
        resolved = await discover();
      } catch {
        return refuse(ctx, "provider_unreachable", "discovery");
      }

      let idToken: string;

      try {
        const reply = await fetchImpl(resolved.document.token_endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          // `client_secret_post`: the secret in the form body, over TLS, to
          // the endpoint discovery named — never in a URL.
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
            code_verifier: codeVerifier,
          }).toString(),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!reply.ok) {
          // A 4xx is the code's fault — spent, expired, or presented with the
          // wrong verifier or redirect URI; a 5xx is the provider's.
          return reply.status >= 500
            ? refuse(
                ctx,
                "provider_unreachable",
                `token ${String(reply.status)}`,
              )
            : refuse(ctx, "code_rejected", `token ${String(reply.status)}`);
        }

        const parsed = tokenResponseSchema.safeParse(await reply.json());

        if (!parsed.success) {
          return refuse(ctx, "provider_unreachable", "token response");
        }

        idToken = parsed.data.id_token;
      } catch {
        return refuse(ctx, "provider_unreachable", "token endpoint");
      }

      let payload: unknown;

      try {
        ({ payload } = await jwtVerify(idToken, resolved.keys, {
          issuer: acceptedIssuers,
          audience: clientId,
          // Google signs with RS256 and nothing else; naming it is what makes
          // an algorithm the issuer never used a refusal rather than a choice
          // the token gets to make.
          algorithms: ["RS256"],
          clockTolerance: clockToleranceSec,
          currentDate: now(),
          // Present, not merely valid-if-present: a token with no `exp` would
          // otherwise never expire. `jose` then checks `exp` (and `nbf`, when
          // there is one) against `currentDate` with the tolerance above.
          requiredClaims: ["exp", "iat", "sub"],
        }));
      } catch (error) {
        const detail = joseCodeOf(error);

        return refuse(ctx, verificationFailure(detail), detail);
      }

      const claims = claimsSchema.safeParse(payload);

      // `sub` or `aud` absent or malformed; every other claim has a fallback.
      if (!claims.success) return refuse(ctx, "claims_invalid", "claims");

      // OIDC Core §3.1.3.7: the token must carry the nonce this attempt sent,
      // or it was minted for another one.
      if (claims.data.nonce !== nonce) return refuse(ctx, "nonce_mismatch");

      // §3.1.3.7 again, both halves. An authorized party, when present, must
      // be this client — the token was issued to somebody else otherwise,
      // whatever its audience list says. And a token with **several**
      // audiences must name us as that party: `jose` accepts any list that
      // merely contains our id, and the other entries are audiences we do not
      // trust (`D19.1`'s `security-reviewer`).
      const multipleAudiences =
        Array.isArray(claims.data.aud) && claims.data.aud.length > 1;

      if (
        (claims.data.azp !== undefined && claims.data.azp !== clientId) ||
        (multipleAudiences && claims.data.azp !== clientId)
      ) {
        return refuse(ctx, "claims_invalid", "azp");
      }

      const { email } = claims.data;
      const emailVerified =
        email !== undefined &&
        (claims.data.email_verified === true ||
          claims.data.email_verified === "true");

      const identity: OidcIdentity = {
        subject: claims.data.sub,
        email,
        emailVerified,
        emailAuthoritative:
          emailVerified && googleIsAuthoritativeFor(email, claims.data.hd),
        givenName: claims.data.given_name,
        familyName: claims.data.family_name,
      };

      return { ok: true, identity };
    },
  };
};
