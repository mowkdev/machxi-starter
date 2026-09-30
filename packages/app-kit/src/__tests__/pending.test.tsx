import { createI18n } from "@repo/i18n";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { AppPending, PENDING_MIN_MS, PENDING_MS } from "../router/pending";

/**
 * The router's pending component (`D31.3`, ADR-0080 §5): what it shows and
 * what it announces. When it shows is the router's, from the two numbers
 * below; the admin's suite proves the binding on the real route tree.
 */

const { instance } = createI18n({
  resources: {
    en: { common: { loading: { pending: "Loading the page…" } } },
  },
  namespaces: ["common"],
  locale: "en",
  storageKeyPrefix: "kit.test",
});

describe("AppPending", () => {
  it("the pending state is visible and announced", () => {
    render(
      <I18nextProvider i18n={instance}>
        <AppPending />
      </I18nextProvider>,
    );

    // One polite status region, named by what it says rather than by a
    // nested label, and the sentence is the app's catalogue's.
    const status = screen.getByRole("status");

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Loading the page…");
    expect(screen.getByText("Loading the page…")).toBeVisible();
    // Hidden elements counted too: the spinner is `aria-hidden`, so only
    // this can see whether its own `role="status"` was stripped.
    expect(screen.getAllByRole("status", { hidden: true })).toHaveLength(1);
  });

  it("waits a second before it appears and then holds half of one", () => {
    // The router's own defaults, kept on the measurement recorded at `D31.3`.
    expect(PENDING_MS).toBe(1000);
    expect(PENDING_MIN_MS).toBe(500);
  });
});
