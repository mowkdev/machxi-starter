import { setupServer } from "msw/node";

/**
 * The MSW server the suite intercepts through (ADR-0036).
 *
 * `msw/node` rather than a service worker: nothing opens a socket, so the task
 * stays cacheable under ADR-0026 and the real ADR-0033 client — interceptors,
 * envelope unwrap, CSRF header, single-flight refresh — runs in every test.
 *
 * It starts with no default handlers on purpose. `D3.4` adds the auth handlers
 * the bootstrap needs; until then an unhandled request is an error, which is
 * the right answer for a step whose components make none.
 */
export const server = setupServer();
