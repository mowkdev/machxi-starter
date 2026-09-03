import type { Population } from "@repo/contracts";
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { isAppError } from "../../errors/index.js";
import { DEFAULT_APP_ID, createCookieNames } from "../../http/index.js";
import { createCsrfGuard } from "../csrf.js";

/**
 * The double-submit check (ADR-0029 §CSRF, as ADR-0056 splits its cookie).
 *
 * What is under test is mostly *when the guard declines to act*: it must be
 * invisible to every `body`-transport caller — mobile clients, Postman, half
 * of the integration suite — and unavoidable for a request leaning on the
 * refresh cookie. The last describe is ADR-0056's addition: which cookie it
 * reads when a browser presents both.
 */

const TOKEN = "csrf-token-value";

/** The default population below; the split is asserted on its own at the end. */
const cookieNames = createCookieNames(DEFAULT_APP_ID);
const REFRESH_COOKIE = cookieNames.refresh;
const CSRF_COOKIE = cookieNames.csrf("staff");

interface RequestShape {
  readonly cookies?: readonly string[];
  readonly header?: string;
  readonly body?: unknown;
}

const requestOf = ({ cookies, header, body }: RequestShape): Request =>
  ({
    headers: cookies === undefined ? {} : { cookie: cookies.join("; ") },
    body,
    get: (name: string) =>
      name.toLowerCase() === "x-csrf-token" ? header : undefined,
  }) as unknown as Request;

/**
 * `allowBodyToken` defaults to true here because most cases below are about
 * `refresh`, the only endpoint where a token in the body is a legitimate way
 * to present the credential. The logout shape — where it is false — has its
 * own case at the end.
 */
const run = (
  shape: RequestShape,
  allowBodyToken = true,
  population: Population = "staff",
) => {
  const next = vi.fn();
  const guard = createCsrfGuard({
    cookies: cookieNames,
    population,
    allowBodyToken,
  });
  const call = () => {
    guard(requestOf(shape), {} as Response, next as NextFunction);
  };

  return { next, call } as const;
};

const expectForbidden = (call: () => void) => {
  expect(call).toThrowError(
    expect.objectContaining({ code: "CSRF_TOKEN_INVALID" }),
  );

  try {
    call();
  } catch (error) {
    expect(isAppError(error) && error.status).toBe(403);
  }
};

describe("csrfGuard", () => {
  describe("requests it does not apply to", () => {
    it("passes a request with no cookies at all", () => {
      // Every mobile client and every Postman run takes this path.
      const { next, call } = run({ body: { refreshToken: "in-the-body" } });

      call();

      expect(next).toHaveBeenCalledOnce();
    });

    it("passes a request whose refresh token is in the body", () => {
      // ADR-0029: a request carrying its own token is not cookie-driven, even
      // if a cookie happens to be attached as well.
      const { next, call } = run({
        cookies: [`${REFRESH_COOKIE}=abc`, `${CSRF_COOKIE}=${TOKEN}`],
        body: { refreshToken: "in-the-body" },
      });

      call();

      expect(next).toHaveBeenCalledOnce();
    });

    it("treats an empty-string body token as absent", () => {
      // Otherwise `{\"refreshToken\": \"\"}` would be a one-field CSRF bypass.
      const { call } = run({
        cookies: [`${REFRESH_COOKIE}=abc`],
        body: { refreshToken: "" },
      });

      expectForbidden(call);
    });

    it("passes a cookie-less request that has a CSRF cookie", () => {
      // Nothing is relying on a refresh cookie, so there is nothing to protect.
      const { next, call } = run({ cookies: [`${CSRF_COOKIE}=${TOKEN}`] });

      call();

      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe("cookie-driven requests", () => {
    const cookies = [`${REFRESH_COOKIE}=abc`, `${CSRF_COOKIE}=${TOKEN}`];

    it("passes when the header matches the cookie", () => {
      const { next, call } = run({ cookies, header: TOKEN });

      call();

      expect(next).toHaveBeenCalledOnce();
    });

    it("refuses a missing header", () => {
      expectForbidden(run({ cookies }).call);
    });

    it("refuses a wrong header", () => {
      expectForbidden(run({ cookies, header: "not-the-token" }).call);
    });

    it("refuses a header that is a prefix of the cookie", () => {
      // The comparison is on the whole value, not a prefix, and the length
      // check in front of `timingSafeEqual` is what makes that true.
      expectForbidden(run({ cookies, header: TOKEN.slice(0, 5) }).call);
    });

    it("refuses when the CSRF cookie is missing entirely", () => {
      expectForbidden(
        run({ cookies: [`${REFRESH_COOKIE}=abc`], header: TOKEN }).call,
      );
    });

    it("refuses an empty CSRF cookie echoed back as an empty header", () => {
      // Two empty strings are equal, which would otherwise pass the check.
      expectForbidden(
        run({
          cookies: [`${REFRESH_COOKIE}=abc`, `${CSRF_COOKIE}=`],
          header: "",
        }).call,
      );
    });

    it("refuses a request with no body at all — logout and logout-all", () => {
      expectForbidden(run({ cookies }).call);
    });

    it("ignores a body token where no body is read at all", () => {
      // `logout` and `logout-all` take no body, so a `refreshToken` field in
      // one means nothing except that somebody wanted the exemption `refresh`
      // has. Not reachable cross-site — both need `Authorization: Bearer` —
      // but an exemption should not be honoured by an endpoint that cannot
      // use it.
      expectForbidden(
        run({ cookies, body: { refreshToken: "in-the-body" } }, false).call,
      );
    });
  });

  /*
   * ADR-0056. Both CSRF cookies are at `Path=/`, so a browser signed into the
   * admin panel and the customer app sends **both** names on every mutating
   * request to either segment. The guard is mounted per segment and reads that
   * segment's cookie; reading the wrong one would refuse a request the client
   * got exactly right, which is the failure this record exists to prevent.
   */
  describe("a browser signed into both populations", () => {
    const OTHER = "the-other-populations-token";
    const both = [
      `${REFRESH_COOKIE}=abc`,
      `${cookieNames.csrf("staff")}=${TOKEN}`,
      `${cookieNames.csrf("user")}=${OTHER}`,
    ];

    it("accepts each population's own token", () => {
      const staff = run({ cookies: both, header: TOKEN }, true, "staff");

      staff.call();
      expect(staff.next).toHaveBeenCalledOnce();

      const user = run({ cookies: both, header: OTHER }, true, "user");

      user.call();
      expect(user.next).toHaveBeenCalledOnce();
    });

    it("refuses the other population's token", () => {
      expectForbidden(
        run({ cookies: both, header: OTHER }, true, "staff").call,
      );
      expectForbidden(run({ cookies: both, header: TOKEN }, true, "user").call);
    });

    it("refuses the retired host-wide cookie", () => {
      // A browser that has not yet been migrated still holds
      // `__Host-machxi.csrf`. It is nobody's population, so it satisfies
      // nothing — the client re-bootstraps and gets a named cookie.
      expectForbidden(
        run(
          {
            cookies: [`${REFRESH_COOKIE}=abc`, `__Host-machxi.csrf=${TOKEN}`],
            header: TOKEN,
          },
          true,
          "staff",
        ).call,
      );
    });
  });
});
