/**
 * The build the sidebar footer names (ADR-0081 §1–§3, the delta on ADR-0054
 * §5; `D32.2`).
 *
 * **Two facts, read from the process environment at build time, under the
 * names every Dockerfile, the reference compose and `turbo.json` use.**
 * `APP_VERSION` is the release label — one value for the whole product, in
 * whatever scheme the owning repository chose, and never parsed. `GIT_SHA` is
 * the commit the image was built from. Both are build arguments of this app's
 * image, promoted to `ENV` in its build stage; nothing reads a `package.json`
 * for either, so the manifest's `version` is inert.
 *
 * **Why an environment value no longer lets a cached build lie**, which is
 * what ADR-0054 §5 refused a commit for: `turbo.json`'s `build` task declares
 * both names in its `env`, so each is part of the task's hash. A build with
 * another label is another hash, never a replay. Locally both are unset, the
 * hash does not move, and the footer says `dev`.
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
  readonly GIT_SHA?: string | undefined;
}

/**
 * A value as given, or `undefined` when it is absent or blank — the API's
 * `optionalEnv` rule, so the footer and `/health` never disagree about a
 * padded or empty build argument.
 */
const given = (value: string | undefined) =>
  value !== undefined && value.trim() !== "" ? value : undefined;

/**
 * The `define` both configs install: `__APP_VERSION__`, the label or `dev`,
 * and `__GIT_SHA__`, the commit or the empty string for none.
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
    __GIT_SHA__: JSON.stringify(given(environment.GIT_SHA) ?? ""),
  }) as const;
