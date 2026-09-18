import type { Page } from "@repo/contracts";

import { createBootstrap } from "../../bootstrap";
import { createApiClient } from "../../client";
import { createSessionStore } from "../../session-store";

import {
  createAuthHandlers,
  createAuthMockState,
  type AuthMockState,
} from "./auth.handlers";
import { server } from "./server";

/**
 * The shared fixture for the client suite (`D20.7`).
 *
 * `setup` and `EMPTY_PAGE` were local to `client.test.ts` until that file was
 * split along the same seam the source was — `transport`, the session
 * lifecycle, and one file per flow group. They are here rather than duplicated
 * into each because the fixture *is* the assertion in several of the cases
 * that use it: the client is built with `segment: "admin"` because that is
 * what `./auth.handlers` answers on, and a second copy that drifted would
 * quietly stop the handlers matching.
 */

/** `Page<T>` in full, so the handler answers the shape ADR-0014 defines. */
export const EMPTY_PAGE: Page<never> = {
  items: [],
  offset: 0,
  limit: 20,
  total: 0,
  sort: [],
  filters: {},
};

export const setup = (state: AuthMockState = createAuthMockState()) => {
  const store = createSessionStore();
  let sessionEndedCalls = 0;
  const client = createApiClient({
    store,
    baseUrl: "http://api.test",
    // The suite's own choice since `D9.1`, not the app's only one: the client
    // is segment-parameterised now, and `admin` is what `support/auth.handlers`
    // answers on. Every assertion below is about behaviour the two segments
    // share, so the value matters only in that it must match the handlers.
    segment: "admin",
    onSessionEnded: () => {
      sessionEndedCalls += 1;
    },
  });

  server.use(...createAuthHandlers(state));

  return {
    store,
    client,
    state,
    bootstrap: createBootstrap(client),
    endedCalls: () => sessionEndedCalls,
  };
};
