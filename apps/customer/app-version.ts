import { readFileSync } from "node:fs";

/**
 * The version this app's chrome shows (ADR-0054 §5, `D12.1`).
 *
 * The admin's `app-version.ts` verbatim in mechanism and separate by
 * construction: **a build-time constant from a tracked source, never a runtime
 * variable and never a git SHA.** An env var would make the version a
 * configuration surface and put it outside the bundle the browser already has;
 * a SHA is truthful at build time and a lie from a warm Turbo cache, and making
 * it a cache input would bust the cache on every commit.
 * `apps/customer/package.json`'s `version` is a file somebody edits on purpose,
 * and it sits inside this package — so it is part of `$TURBO_DEFAULT$` and a
 * bump invalidates the `build` task by itself, with nothing added to
 * `turbo.json` and nothing to remember.
 *
 * **Duplicated rather than shared, and deliberately so** — which is why it is
 * argued here and not logged in the plan's §Findings. Extracting it would mean
 * a package that reads *its consumer's* `package.json`, a worse shape than
 * eighteen lines of a constant each app owns: the two versions are meant to
 * move independently, and the reason the value is a tracked file at all is that
 * it belongs to one buildable thing. The same reasoning covers the copied
 * `scripts/size.mjs` and `scripts/i18n.mjs`, each of which says so in its own
 * header.
 *
 * The obligation the record names comes with it: **bump the field or the
 * version lies.** It says `0.0.0` until the first release does.
 *
 * Read here rather than in each config because `vite.config.ts` and
 * `vitest.config.ts` both need it and Vitest reads only the latter — a
 * `define` written in one and not the other is a suite that asserts a global
 * the app does not ship, or a build that ships one no test ever saw.
 */
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * The `define` both configs install.
 *
 * `JSON.stringify`, because `define` performs a textual substitution: the raw
 * string would be spliced in as an identifier and fail to compile.
 */
export const versionDefine = {
  __APP_VERSION__: JSON.stringify(version),
} as const;
