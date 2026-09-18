import { expect, test } from "@playwright/test";

/**
 * The built image's response headers (ADR-0073 §9; ADR-0059 §4).
 *
 * **Against the image, not the dev server.** Every other spec here runs
 * against `pnpm dev`, which is where the app's behaviour is; the headers are
 * nginx's, and Vite's server sends none of them — a policy on the dev server
 * would break the React refresh preamble, which is an inline script. So the
 * spec skips, and says so, on the tier's **default** target — the dev server
 * `playwright.config.ts` falls back to when `E2E_BASE_URL` is unset — rather
 * than failing a run that never built an image.
 *
 * **The skip is keyed on the operator's intent, not on what the server says
 * about itself.** With `E2E_BASE_URL` set the spec asserts, whatever answers:
 * a proxy that rewrites `Server`, or an image that lost its headers, is then
 * a failure and not a quiet skip — a detection on `Server: nginx` alone could
 * only ever skip its way to green (`D20.8`'s `security-reviewer`). The
 * header is still read, so the failure names what actually answered.
 *
 * To run it for real: build the image, run it on a free port, point the tier
 * at it — `E2E_BASE_URL=http://127.0.0.1:3101 pnpm --filter admin test:e2e
 * e2e/smoke.spec.ts`. Only the request context is used, so no browser opens
 * and no login is spent.
 *
 * The signed-in `app` fixture is deliberately not imported: a static file
 * needs no session, and the fixture's one login per run is a budget the other
 * specs share (ADR-0020's login limiter).
 */

/** A Content-Security-Policy string as a directive → sources map. */
const directivesOf = (policy: string): Record<string, string> =>
  Object.fromEntries(
    policy
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name = "", ...sources] = directive.split(/\s+/);
        return [name, sources.join(" ")];
      }),
  );

test("the built image sends the policy on the shell, a deep link and a 404", async ({
  request,
}) => {
  test.skip(
    process.env["E2E_BASE_URL"] === undefined,
    "the tier's default target is the dev server, which sends no headers; point E2E_BASE_URL at a running apps/admin image",
  );

  const root = await request.get("/");
  const server = root.headers()["server"] ?? "absent";

  expect(server, `expected the nginx image, got Server: ${server}`).toMatch(
    /^nginx/,
  );

  /*
   * Three answers, three code paths in the server config: the index, the SPA
   * fallback that serves it for a route the router owns, and a miss under
   * `/assets/` — which is where `always` matters, because without it nginx
   * drops every `add_header` from an error response.
   */
  const deepLink = await request.get("/staff");
  const miss = await request.get("/assets/does-not-exist.js");

  expect(root.status()).toBe(200);
  expect(deepLink.status()).toBe(200);
  expect(miss.status()).toBe(404);

  for (const response of [root, deepLink, miss]) {
    const policy = response.headers()["content-security-policy"];

    expect(policy, `${response.url()} carries no policy`).toBeDefined();

    const directives = directivesOf(policy ?? "");

    expect(directives["script-src"]).toBe("'self'");
    expect(directives["frame-ancestors"]).toBe("'none'");
    expect(directives["default-src"]).toBe("'self'");
    expect(directives["object-src"]).toBe("'none'");
    /*
     * The build argument reached the config: `'self'` and exactly one origin,
     * and not the placeholder the Dockerfile refuses to leave behind.
     */
    expect(directives["connect-src"]).toMatch(/^'self' https?:\/\/[^\s/]+$/);
  }
});
