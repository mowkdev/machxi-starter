import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryStorage,
  gridStorageKey,
  type PreferenceStorage,
} from "../preferences";
import {
  PreferenceStorageProvider,
  useGridPreferences,
} from "../use-grid-preferences";

/**
 * The adapter's default, now supplied by the app (`D6.3`, ADR-0045).
 *
 * ADR-0041 wrote of `use-grid-preferences.ts` that it is "the reason the future
 * server-backed adapter changes one file rather than a component tree". This
 * is that claim as three assertions: the prop still wins, the context is the
 * app's default, and `localStorage` is what a tree with neither still gets.
 */

const DEFAULTS = ["email", "status"] as const;

const width = (value: number) =>
  JSON.stringify({
    v: 1,
    sizing: { email: value },
    order: [...DEFAULTS],
    hidden: [],
  });

const Probe = ({ storage }: { storage?: PreferenceStorage | undefined }) => {
  const [preferences] = useGridPreferences({
    keyPrefix: "machxi.admin",
    gridId: "staff",
    movable: DEFAULTS,
    storage,
  });

  return <output>{preferences.sizing.email ?? "auto"}</output>;
};

afterEach(() => {
  window.localStorage.clear();
});

describe("where a grid's adapter comes from", () => {
  it("uses the one the app provided", () => {
    const provided = createMemoryStorage();

    provided.write(gridStorageKey("machxi.admin", "staff"), width(300));

    render(
      <PreferenceStorageProvider value={provided}>
        <Probe />
      </PreferenceStorageProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("300");
  });

  it("lets a call site override it, which is what the prop is for", () => {
    const provided = createMemoryStorage();
    const override = createMemoryStorage();

    provided.write(gridStorageKey("machxi.admin", "staff"), width(300));
    override.write(gridStorageKey("machxi.admin", "staff"), width(500));

    render(
      <PreferenceStorageProvider value={provided}>
        <Probe storage={override} />
      </PreferenceStorageProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("500");
  });

  it("falls back to `localStorage` where nothing provides one", () => {
    window.localStorage.setItem(
      gridStorageKey("machxi.admin", "staff"),
      width(180),
    );

    render(<Probe />);

    // The signed-out app, and every suite that does not wire settings: exactly
    // the behaviour ADR-0041 shipped, reached through a context default.
    expect(screen.getByRole("status")).toHaveTextContent("180");
  });
});
