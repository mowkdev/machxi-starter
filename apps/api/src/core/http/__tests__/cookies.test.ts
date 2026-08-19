import type { Request } from "express";
import { describe, expect, it } from "vitest";

import {
  CSRF_COOKIE,
  CSRF_COOKIE_PATH,
  REFRESH_COOKIE,
  authCookiePath,
  readCookie,
} from "../cookies.js";

/**
 * The cookie reader (ADR-0029).
 *
 * Written out rather than taken from a package, so its edges are tested here
 * rather than assumed: a value containing `=`, a name that is a suffix of
 * another name, and the whitespace RFC 6265 puts between pairs.
 */

const withCookies = (header?: string): Request =>
  ({ headers: header === undefined ? {} : { cookie: header } }) as Request;

describe("readCookie", () => {
  it("reads a single cookie", () => {
    expect(withCookies(`${REFRESH_COOKIE}=abc`)).toBeDefined();
    expect(
      readCookie(withCookies(`${REFRESH_COOKIE}=abc`), REFRESH_COOKIE),
    ).toBe("abc");
  });

  it("finds one among several, whatever the spacing", () => {
    const header = `other=1;${REFRESH_COOKIE}=abc;   ${CSRF_COOKIE}=def`;

    expect(readCookie(withCookies(header), REFRESH_COOKIE)).toBe("abc");
    expect(readCookie(withCookies(header), CSRF_COOKIE)).toBe("def");
  });

  it("keeps a value that contains `=`", () => {
    // base64 padding is the realistic case; a naive `split(\"=\")` truncates it.
    expect(readCookie(withCookies(`${CSRF_COOKIE}=a=b==`), CSRF_COOKIE)).toBe(
      "a=b==",
    );
  });

  it("matches the name exactly, so a suffix cannot impersonate it", () => {
    // `evil.machxi.csrf` ends with the real name; a `endsWith` or `includes`
    // check would hand the attacker's value to the CSRF comparison.
    const header = `evil.${CSRF_COOKIE}=attacker`;

    expect(readCookie(withCookies(header), CSRF_COOKIE)).toBeUndefined();
  });

  it("decodes what `res.cookie` encoded", () => {
    expect(readCookie(withCookies(`${CSRF_COOKIE}=a%20b`), CSRF_COOKIE)).toBe(
      "a b",
    );
  });

  it("treats a malformed encoding as no cookie at all", () => {
    expect(
      readCookie(withCookies(`${CSRF_COOKIE}=%E0%A4%A`), CSRF_COOKIE),
    ).toBeUndefined();
  });

  it("yields nothing when the name appears twice", () => {
    // RFC 6265 section 5.4 orders the header by descending path length, so a
    // sibling subdomain that can set `Domain=` cookies chooses what a
    // first-match reader sees: the attacker's CSRF token, or their refresh
    // token. Failing closed costs a real client a re-login and costs the
    // attacker the attack.
    const shadowed = `${CSRF_COOKIE}=attacker; ${CSRF_COOKIE}=ours`;

    expect(readCookie(withCookies(shadowed), CSRF_COOKIE)).toBeUndefined();
  });

  it("fails closed even when the shadow is malformed", () => {
    // A duplicate that throws in `decodeURIComponent` must not let the second
    // one through as though it were the only one.
    const shadowed = `${REFRESH_COOKIE}=%E0%A4%A; ${REFRESH_COOKIE}=ours`;

    expect(readCookie(withCookies(shadowed), REFRESH_COOKIE)).toBeUndefined();
  });

  it("is undefined for a missing header, a missing name and a pair with no `=`", () => {
    expect(readCookie(withCookies(), REFRESH_COOKIE)).toBeUndefined();
    expect(readCookie(withCookies("other=1"), REFRESH_COOKIE)).toBeUndefined();
    expect(readCookie(withCookies("novalue"), "novalue")).toBeUndefined();
  });
});

describe("authCookiePath", () => {
  it("scopes each population to its own segment (ADR-0019 §1)", () => {
    // A browser signed into both holds two refresh cookies, and neither is
    // ever sent to the other's endpoints.
    expect(authCookiePath("staff")).toBe("/api/v1/admin/auth");
    expect(authCookiePath("user")).toBe("/api/v1/user/auth");
  });

  it("scopes them below `/api/v1`, which is why `__Host-` is not used", () => {
    // `__Host-` would require `Path=/`, attaching a thirty-day credential to
    // every request this API serves.
    for (const population of ["staff", "user"] as const) {
      expect(authCookiePath(population).startsWith("/api/v1/")).toBe(true);
      expect(authCookiePath(population)).not.toBe("/");
    }
  });
});

describe("the cookie names", () => {
  it("gives each cookie the prefix its job allows", () => {
    // The credential is path-scoped, so it cannot take `__Host-`, which
    // requires `Path=/` and would attach a thirty-day token to every request
    // this API serves.
    expect(REFRESH_COOKIE.startsWith("__Secure-")).toBe(true);
    expect(REFRESH_COOKIE.startsWith("__Host-")).toBe(false);

    // The CSRF token has to be readable at the *document's* path, so it is at
    // `Path=/` anyway — which makes `__Host-` free, and host-only is exactly
    // what stops a sibling subdomain shadowing it.
    expect(CSRF_COOKIE.startsWith("__Host-")).toBe(true);
    expect(CSRF_COOKIE_PATH).toBe("/");
  });
});
