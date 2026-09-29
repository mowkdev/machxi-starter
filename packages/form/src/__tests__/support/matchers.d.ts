/**
 * jest-dom's matchers, for the compiler (`D22.3`, ADR-0036).
 *
 * The suite installs them at runtime through `@repo/app-kit/testing/setup`,
 * which `vitest.config.ts` names as its setup file since the door-level suites
 * moved in (ADR-0077 §4). That file is another package's, outside this
 * package's TypeScript program, so its `declare module "vitest"` augmentation
 * would reach nothing here and every `toBeInTheDocument()` would be a red
 * `check-types` against a green run. The apps carry the same declaration in
 * `test/matchers.d.ts`, for the same reason.
 *
 * A declaration rather than a re-export: it adds no runtime import.
 */
import "@testing-library/jest-dom/vitest";
