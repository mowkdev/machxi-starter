import type { Request } from "express";
import { describe, expect, it } from "vitest";

import {
  CSRF_COOKIE_PATH,
  DEFAULT_APP_ID,
  authCookiePath,
  createCookieNames,
  readCookie,
} from "../cookies.js";

/**
 * The cookie reader (ADR-0029).
 *
 * Written out rather than taken from a package, so its edges are tested here
 * rather than assumed: a value containing `=`, a name that is a suffix of
 * another name, and the whitespace RFC 6265 puts between pairs.
 */

/**
 * One concrete CSRF cookie name for the reader's edge cases.
 *
 * The reader knows nothing about populations — it is given a string — so these
 * tests want *a* name rather than every name, and picking one keeps them about
 * `readCookie` (ADR-0056 made the constant a function; the describe below is
 * where the names themselves are asserted).
 */
const COOKIE_NAMES = createCookieNames(DEFAULT_APP_ID);
const REFRESH_COOKIE = COOKIE_NAMES.refresh;
const LEGACY_CSRF_COOKIE = COOKIE_NAMES.legacyCsrf;
const CSRF_COOKIE = COOKIE_NAMES.csrf("staff");

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

describe("the population's CSRF cookie name", () => {
  it("gives each population its own name (ADR-0056)", () => {
    // The whole of the fix: two SPAs against one API host stop sharing one
    // mutable cookie, so neither app's rotation strands the other's token.
    expect(COOKIE_NAMES.csrf("staff")).toBe("__Host-machxi.csrf.admin");
    expect(COOKIE_NAMES.csrf("user")).toBe("__Host-machxi.csrf.user");
    expect(COOKIE_NAMES.csrf("staff")).not.toBe(COOKIE_NAMES.csrf("user"));
  });

  it("keeps the `__Host-` prefix on both", () => {
    // `__Host-` constrains `Path` and `Domain`, not the name, so the split
    // costs none of the prefix's guarantees — the alternative considered and
    // rejected in ADR-0056 was scoping by path, which would have.
    for (const population of ["staff", "user"] as const) {
      expect(COOKIE_NAMES.csrf(population).startsWith("__Host-")).toBe(true);
    }
  });

  it("extends the legacy name rather than replacing it, which is why readCookie matches exactly", () => {
    // Both new names *begin with* the retired one, so a reader that ever went
    // back to `startsWith` would hand `__Host-machxi.csrf` to the
    // double-submit check as though it were a population's. `readCookie`
    // matches the whole name, which is what makes the retired cookie satisfy
    // nothing. Neither new name is a suffix of the other either.
    const names = [COOKIE_NAMES.csrf("staff"), COOKIE_NAMES.csrf("user")];

    for (const name of names) {
      expect(name.startsWith(LEGACY_CSRF_COOKIE)).toBe(true);
      expect(name).not.toBe(LEGACY_CSRF_COOKIE);
    }

    expect(names[0]?.endsWith(names[1] ?? "")).toBe(false);
    expect(names[1]?.endsWith(names[0] ?? "")).toBe(false);
  });
});

/**
 * ADR-0064 §1: one identifier, four names.
 *
 * Two claims, and the second is what makes the change reviewable at all: the
 * brand is a parameter, and the parameter's default reproduces every literal
 * this file used to hold byte for byte.
 */
describe("createCookieNames", () => {
  it("defaults to the names this repository has always set", () => {
    expect(DEFAULT_APP_ID).toBe("machxi");
    expect(COOKIE_NAMES.refresh).toBe("__Secure-machxi.refresh");
    expect(COOKIE_NAMES.legacyCsrf).toBe("__Host-machxi.csrf");
    expect(COOKIE_NAMES.csrf("staff")).toBe("__Host-machxi.csrf.admin");
    expect(COOKIE_NAMES.csrf("user")).toBe("__Host-machxi.csrf.user");
  });

  it("takes the leading word of every name from the identifier", () => {
    const acme = createCookieNames("acme");

    expect(acme.refresh).toBe("__Secure-acme.refresh");
    expect(acme.legacyCsrf).toBe("__Host-acme.csrf");
    expect(acme.csrf("staff")).toBe("__Host-acme.csrf.admin");
    expect(acme.csrf("user")).toBe("__Host-acme.csrf.user");
  });

  it("keeps every prefix and every suffix the brand does not own", () => {
    // The *shape* of these names is still a constant (ADR-0064 §1): a rename
    // must not be able to drop `__Secure-`, drop `__Host-`, or turn the
    // segment suffix into the population word.
    const acme = createCookieNames("acme");

    expect(acme.refresh.startsWith("__Secure-")).toBe(true);
    expect(acme.csrf("staff").startsWith("__Host-")).toBe(true);
    expect(acme.csrf("user").startsWith("__Host-")).toBe(true);
    expect(acme.csrf("staff").endsWith(".admin")).toBe(true);
    expect(acme.csrf("user").endsWith(".user")).toBe(true);
  });

  it("gives two deployments on one host four distinct names", () => {
    // The property a fork depends on: an `acme` deployment beside a `machxi`
    // one shares no cookie, so neither can clear or shadow the other's.
    const acme = createCookieNames("acme");
    const all = [
      COOKIE_NAMES.refresh,
      COOKIE_NAMES.csrf("staff"),
      acme.refresh,
      acme.csrf("staff"),
    ];

    expect(new Set(all).size).toBe(all.length);
  });
});
