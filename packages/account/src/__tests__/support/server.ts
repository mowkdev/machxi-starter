import { setupServer } from "msw/node";

/**
 * The package suite's MSW server, started with no handlers: a suite's handlers
 * are its own, declared per file (ADR-0036).
 */
export const server = setupServer();
