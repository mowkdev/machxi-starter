import { nodeConfig } from "@repo/vitest-config/node";

/**
 * The package's suite (`D9.3`, ADR-0036).
 *
 * `nodeConfig` — and here that is not a transport question the way it was for
 * `@repo/api-client`. This package is a vocabulary: types, and pure functions
 * over config objects. Nothing it owns renders, fetches or reads the browser.
 */
export default nodeConfig;
