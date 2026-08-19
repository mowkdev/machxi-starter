import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { isAppError } from "../../errors/index.js";
import { CSRF_COOKIE, REFRESH_COOKIE } from "../../http/index.js";
import { createCsrfGuard } from "../csrf.js";

/**
 * The double-submit check (ADR-0029 §CSRF).
 *
 * What is under test is mostly *when the guard declines to act*: it must be
 * invisible to every `body`-transport caller — mobile clients, Postman, half
 * of the integration suite — and unavoidable for a request leaning on the
 * refresh cookie.
 */

const TOKEN = "csrf-token-value";

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
const run = (shape: RequestShape, allowBodyToken = true) => {
  const next = vi.fn();
  const guard = createCsrfGuard({ allowBodyToken });
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
});
