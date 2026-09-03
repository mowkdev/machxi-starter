/**
 * jest-dom's matchers, for the compiler (ADR-0036, `D14.8`).
 *
 * The suite installs them at runtime through `@repo/app-kit/testing/setup`,
 * which `vitest.config.ts` names as its setup file. That file lives in a
 * package and is therefore outside this app's TypeScript program, so nothing
 * here would carry its `declare module "vitest"` augmentation and every
 * `toBeInTheDocument()` in the suite would be a red `check-types` against a
 * green test run — the worst pairing two checks can have.
 *
 * A declaration rather than a re-export: it adds no runtime import and exists
 * only so the program sees the augmentation the harness applies.
 */
import "@testing-library/jest-dom/vitest";
