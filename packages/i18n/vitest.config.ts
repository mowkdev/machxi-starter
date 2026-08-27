import { reactConfig } from "@repo/vitest-config/react";

/**
 * The package's suite (`D9.2`, ADR-0036).
 *
 * `reactConfig`, and therefore jsdom, because two of the things this package
 * owns read the browser: `resolve-locale` negotiates from `navigator.languages`
 * and `locale-storage` caches in `localStorage` (ADR-0046 §4). A node
 * environment would have neither, so the suite would be asserting against
 * stubs of the two APIs the decision actually rests on.
 */
export default reactConfig;
