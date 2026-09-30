/**
 * The build the sidebar footer names (ADR-0081 §1–§3, the delta on ADR-0054
 * §5; `D32.2`, and `D32.5` for the label alone).
 *
 * **One fact, read from the process environment at build time, under the name
 * every Dockerfile, the reference compose and `turbo.json` use.**
 * `APP_VERSION` is the release label — one value for the whole product, in
 * whatever scheme the owning repository chose, and never parsed. It is a build
 * argument of this app's image, promoted to `ENV` in its build stage; nothing
 * reads a `package.json` for it, so the manifest's `version` is inert.
 *
 * **No commit.** The footer shows the label alone, on the operator's decision
 * at `D32.5`: the commit is the API's `/health` fact, and this app does not
 * take `GIT_SHA` at all — no `define`, no `turbo.json` `env` entry, no `ARG`.
 *
 * **Why an environment value no longer lets a cached build lie**, which is
 * what ADR-0054 §5 refused a commit for: `turbo.json`'s `build` task declares
 * `APP_VERSION` in its `env`, so it is part of the task's hash. A build with
 * another label is another hash, never a replay. Locally it is unset, the hash
 * does not move, and the footer says `dev`.
 *
 * Blank is unset, as in the API's `core/config`: a Docker build that passes
 * no `--build-arg` still declares the `ARG`, and the empty string it leaves
 * would render as a footer with nothing in it.
 *
 * Read here rather than in each config because `vite.config.ts` and
 * `vitest.config.ts` both install the `define` and Vitest reads only the
 * latter — a `define` written in one and not the other is a suite that asserts
 * a global the app does not ship, or a build that ships one no test ever saw.
 */
interface BuildEnvironment {
  readonly APP_VERSION?: string | undefined;
}

/**
 * A value as given, or `undefined` when it is absent or blank — the API's
 * `optionalEnv` rule, so the footer and `/health` never disagree about a
 * padded or empty build argument.
 */
const given = (value: string | undefined) =>
  value !== undefined && value.trim() !== "" ? value : undefined;

/**
 * The `define` both configs install: `__APP_VERSION__`, the label or `dev`.
 *
 * `vite.config.ts` passes `process.env`; `vitest.config.ts` passes nothing
 * set, so the suite is a pure function of the tree whatever the shell holds.
 *
 * `JSON.stringify`, because `define` performs a textual substitution: the raw
 * string would be spliced in as an identifier and fail to compile.
 */
export const versionDefine = (environment: BuildEnvironment) =>
  ({
    __APP_VERSION__: JSON.stringify(given(environment.APP_VERSION) ?? "dev"),
  }) as const;
