import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./server";

/**
 * The MSW lifecycle, per ADR-0036.
 *
 * `onUnhandledRequest: "error"` is the half worth stating: a request nobody
 * mocked would otherwise fall through to a real socket and fail slowly, or
 * worse, succeed against whatever is listening. Failing loudly at the boundary
 * is what keeps "the suite needs no server" true rather than merely intended.
 */
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
