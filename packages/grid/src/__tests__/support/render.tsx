import { createI18n, type TranslateKey } from "@repo/i18n";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

import en from "../../locales/en.json";

/**
 * The package's own minimal harness (`D9.4`, ADR-0036).
 *
 * **It builds an instance from this package's namespace and nothing else**,
 * which is the whole point: a grid test that needed the admin's ten catalogues
 * was a test about that app's dictionary and went back there. What is left
 * here can be asked of the grid with only its own copy mounted.
 *
 * **Those went-back suites came home at `D22.3`** (ADR-0077 §4): what they
 * read of the admin's dictionary was the grid's namespace, the demo fixture's
 * and an enum's `common:options`, so `demo-i18n.ts` composes exactly those and
 * the door-level cases run in this package beside the ones below.
 *
 * `@repo/i18n`'s factory rather than a stub, so the `t` these tests pass into
 * `buildColumns` is the same kind of translator the app supplies — including
 * the `defaultValue` behaviour that config-supplied labels lean on.
 */
/**
 * A stand-in for the consuming app's `common` namespace.
 *
 * **Not decoration.** `optionLabel` resolves `common:options.<value>` with
 * `humanize(value)` as its default (`@repo/resource`), so a harness with no
 * `common` block makes every status and roles cell pass through that fallback
 * — and an assertion on "Active" would then hold with no catalogue mounted at
 * all, which is the opposite of what a registry test is for. Deliberately
 * *not* English, so a case that reads these words can only have got them from
 * the catalogue.
 *
 * That `@repo/resource` names `common:` at all is a borrowing of the same
 * kind `D9.4` removed from the grid, one layer down; it is D9's close-out to
 * decide, and this stub is what keeps the test honest until then.
 */
const common = {
  options: { active: "Aktīvs", disabled: "Atspējots" },
};

export const gridI18n = () =>
  createI18n({
    resources: { en: { grid: en, common } },
    // A prefix an app would supply (ADR-0064 §1); nothing here reads it back.
    storageKeyPrefix: "test.admin",
    namespaces: ["grid", "common"],
    locale: "en",
  });

export const translator = (): TranslateKey => gridI18n().t as TranslateKey;

export const renderWithI18n = (ui: ReactElement): RenderResult =>
  render(<I18nextProvider i18n={gridI18n().instance}>{ui}</I18nextProvider>);
