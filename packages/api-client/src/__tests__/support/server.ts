import { setupServer } from "msw/node";

/**
 * The MSW server this package's suite intercepts through (`D9.1`, ADR-0036).
 *
 * `msw/node` rather than a service worker: nothing opens a socket, so the task
 * stays cacheable under ADR-0026 and the real client — interceptors, envelope
 * unwrap, CSRF header, single-flight refresh — runs in every test.
 *
 * **This package has a harness of its own rather than borrowing the admin's,
 * and the reason is the boundary the extraction exists to draw**: a package
 * whose tests import from `apps/admin` would make the app a dependency of the
 * thing it consumes. The admin keeps its copy because twelve of its own test
 * files build on it (its resource handlers extend the same envelope), so the
 * duplication is two harnesses with one shape rather than a shared one moved.
 * It is recorded in `docs/plan/0009-platform-extraction.md` §1 rather than
 * left to be discovered: a shared test-harness package is a real option and
 * this deliverable does not take it.
 */
export const server = setupServer();
