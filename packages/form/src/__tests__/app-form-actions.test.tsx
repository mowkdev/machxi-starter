import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppFormActions } from "../app-form-frame";
import { renderWithI18n } from "./support/render";

/**
 * The pending submit's spoken name, seen under the pseudo-locale (`D22.3`,
 * ADR-0046 §10, §12; the review's `FE-10`, closed at `D28.8`).
 *
 * `@repo/ui`'s `Spinner` hard-codes `aria-label="Loading"` and stays
 * byte-identical (ADR-0047), so `AppFormActions` supplies the name at the call
 * from this package's own `form:actions.pending`. Nothing certified that in
 * this package: the admin's route walk under the pseudo-locale renders no
 * pending form, and the moved surface suites read the name by a `/Save/`
 * pattern that any English word beside it satisfies. So the lens is turned
 * on here, where the lens makes a hardcoded word visible — an accented,
 * bracketed label is one that came through `t()` — and the key is asked for
 * by name, so that a label resolved from nothing cannot pass either.
 */
describe("the pending submit", () => {
  it("the pending submit label is a catalogue string", () => {
    const { i18n } = renderWithI18n(
      <AppFormActions isPending onCancel={vi.fn()} submitLabel="Save" />,
      { pseudo: true },
    );

    const label = screen.getByRole("status").getAttribute("aria-label") ?? "";

    // In the catalogue, rather than a key i18next echoed back.
    expect(i18n.instance.exists("form:actions.pending")).toBe(true);
    // Through the lens, rather than the primitive's own English default.
    expect(label).not.toBe("Loading");
    expect(label).toMatch(/^\[.+\]$/);
    expect(label).toBe(i18n.t("form:actions.pending"));
  });
});
