import type { Response, Test } from "supertest";
import { expect } from "vitest";

/**
 * The two token transports, as an axis the auth suite can be run over
 * (ADR-0029).
 *
 * ADR-0021 already parameterises the auth flows by population; transport is
 * the second axis on the same case object, and the reason it belongs there
 * rather than in a file of its own is that the *flows* must not differ. Where
 * the refresh token travels is the only thing that changes, so anything a
 * `body` client can do a `cookie` client must be able to do too — that claim
 * is only worth something if the same assertions run both ways.
 *
 * Cookies are carried by hand rather than by `supertest.agent`, which keeps a
 * jar: the jar honours the `Secure` attribute and would refuse to send these
 * cookies back over the plain-HTTP loopback the suite runs on. Doing it
 * explicitly also means each test states which credential it is presenting,
 * which is the thing under test.
 */

export const REFRESH_COOKIE = "__Secure-machxi.refresh";
export const CSRF_COOKIE = "machxi.csrf";
export const TRANSPORT_HEADER = "X-Auth-Transport";
export const CSRF_HEADER = "X-CSRF-Token";

/** Every `Set-Cookie` on a response, as raw strings. */
export const setCookies = (response: Response): readonly string[] => {
  const header: unknown = response.headers["set-cookie"];

  if (header === undefined) return [];

  return Array.isArray(header) ? (header as string[]) : [String(header)];
};

/** One `Set-Cookie` by name, attributes and all. */
export const setCookie = (
  response: Response,
  name: string,
): string | undefined =>
  setCookies(response).find((cookie) => cookie.startsWith(`${name}=`));

/** The value of one `Set-Cookie`, or `undefined` when it was not set. */
export const cookieValue = (
  response: Response,
  name: string,
): string | undefined => {
  const cookie = setCookie(response, name);

  if (cookie === undefined) return undefined;

  const value = cookie.slice(name.length + 1).split(";")[0];

  return value === undefined || value === "" ? undefined : value;
};

/**
 * What a client keeps from a token response in order to refresh or log out
 * later — and how it presents it.
 *
 * The whole point of the abstraction: a `body` client carries a string it puts
 * in a request body, and a `cookie` client carries two cookies plus the CSRF
 * token it must echo. Both are "the credential", and every test below the
 * abstraction is written once.
 */
export interface Carrier {
  /** Applies the credential to a request the way this transport does. */
  readonly present: (request: Test) => Test;
  /** The raw refresh token, where the transport lets a client see it. */
  readonly token: string | undefined;
}

export interface TransportCase {
  readonly name: "body" | "cookie";
  /** Headers that ask for this transport on `login`, `refresh`, `register`. */
  readonly ask: (request: Test) => Test;
  /** Reads the credential out of a login/refresh/register response. */
  readonly carry: (response: Response) => Carrier;
}

const bodyCarrier = (token: string | undefined): Carrier => ({
  token,
  present: (request) => request.send({ refreshToken: token }),
});

const cookieCarrier = (refresh: string, csrf: string): Carrier => ({
  // Deliberately `undefined`: the token exists, and this transport's whole
  // purpose is that the client cannot read it.
  token: undefined,
  present: (request) =>
    request
      .set("Cookie", [`${REFRESH_COOKIE}=${refresh}`, `${CSRF_COOKIE}=${csrf}`])
      .set(CSRF_HEADER, csrf),
});

export const TRANSPORTS: readonly TransportCase[] = [
  {
    name: "body",
    // No header at all, which is the default and therefore the case that
    // proves D1's callers were not broken by ADR-0029.
    ask: (request) => request,
    carry: (response) =>
      bodyCarrier(response.body.data.refreshToken as string | undefined),
  },
  {
    name: "cookie",
    ask: (request) => request.set(TRANSPORT_HEADER, "cookie"),
    carry: (response) => {
      const refresh = cookieValue(response, REFRESH_COOKIE);
      const csrf = cookieValue(response, CSRF_COOKIE);

      // Failing here rather than passing `undefined` down: a missing cookie is
      // the bug this transport would otherwise hide, and every later assertion
      // would report something less useful.
      expect(refresh, "the response must set the refresh cookie").toEqual(
        expect.any(String),
      );
      expect(csrf, "the response must set the CSRF cookie").toEqual(
        expect.any(String),
      );

      return cookieCarrier(refresh ?? "", csrf ?? "");
    },
  },
];
