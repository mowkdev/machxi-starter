import { setupServer } from "msw/node";

/**
 * The MSW server the suite intercepts through (ADR-0036).
 *
 * `msw/node` rather than a service worker: nothing opens a socket, so the task
 * stays cacheable under ADR-0026 and the real ADR-0033 client — interceptors,
 * envelope unwrap, CSRF header, single-flight refresh — runs in every test.
 *
 * It starts with no default handlers on purpose: an unhandled request is an
 * error, and `src/test/setup.ts` sets `onUnhandledRequest: "error"` so a
 * request nobody mocked fails loudly at the boundary instead of falling through
 * to a real socket. A test that needs a scripted scenario builds its own state
 * and `server.use(...)`es it; `resetHandlers()` puts the defaults back.
 */
export const server = setupServer();
