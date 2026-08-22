import type { ListQuerySearch, Page, StaffResource } from "@repo/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";

import { AppGrid } from "@/shared/grid/app-grid";
import { listSearchDefaults } from "@/shared/grid/list-state";
import {
  EN_RESOURCES,
  NAMESPACES,
  createI18n,
  type Catalogue,
  type I18n,
} from "@/shared/i18n";
import { staffResourceConfig } from "../staff.config";

/**
 * The config's copy, resolved (`D7.4`; ADR-0046 §7, ADR-0035).
 *
 * The claim under test is the one that decides whether ADR-0035's "config is
 * serializable data" survived contact with i18n: **a key is data**. The staff
 * config carries `staff:columns.email` and no sentence at all, and what an
 * operator reads is produced by the rendering machinery — which never learns
 * that this resource is called staff.
 *
 * The compiler owns half of it already: `header`, `label`, `description`,
 * `placeholder` and the hot-filter labels are `TranslationKey`s, so a typo is a
 * failed `check-types` (`staff.config.test.ts` asserts that with a deliberate
 * `@ts-expect-error`). What a type cannot say is that the key **reaches the
 * screen** through a namespace nothing loaded, or that a locale switch moves
 * it. That is what is here.
 */

const EMPTY: Catalogue = Object.fromEntries(
  NAMESPACES.map((namespace) => [namespace, {}]),
) as Catalogue;

/**
 * A partly-translated `lv`, built in the test rather than read from disk.
 *
 * `locales/lv/*.json` are still `{}` until `D7.6`, so a switch against the real
 * catalogues could only ever show the `en` fallback — which proves the fallback
 * and not the plumbing. Two Latvian strings against ten empty namespaces is the
 * honest shape of a translation in progress, and it exercises both halves at
 * once: what `lv` answers moves, and what it does not stays English.
 */
const LV: Catalogue = {
  ...EMPTY,
  staff: {
    columns: { email: "E-pasts" },
    empty: "Neviens darbinieks neatbilst šim skatam.",
  },
};

const withLatvian = (): I18n =>
  createI18n({
    resources: { en: EN_RESOURCES, lv: LV },
    namespaces: NAMESPACES,
    locale: "en",
  });

const row: StaffResource = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@machxi.local",
  firstName: "Ada",
  lastName: "Lovelace",
  roles: ["super_admin"],
  status: "active",
  lastLoginAt: null,
  createdAt: "2026-01-15T10:00:00.000Z",
  updatedAt: "2026-01-15T10:00:00.000Z",
};

const pageOf = (items: readonly StaffResource[]): Page<StaffResource> => ({
  items,
  total: items.length,
  offset: 0,
  limit: 20,
  sort: [],
  filters: {},
});

const base: ListQuerySearch = listSearchDefaults;

const renderGrid = (i18n: I18n, items: readonly StaffResource[]) => {
  const Harness = () => {
    const [listState, setListState] = useState(base);

    return (
      <AppGrid
        columns={staffResourceConfig.columns}
        page={pageOf(items)}
        listState={listState}
        onListStateChange={setListState}
        hotFilters={staffResourceConfig.grid.hotFilters}
        emptyMessage="staff:empty"
        getRowId={(staff) => staff.id}
      />
    );
  };

  return render(
    <I18nextProvider i18n={i18n.instance}>
      <Harness />
    </I18nextProvider>,
  );
};

describe("the staff config's keys on screen", () => {
  it("declares keys rather than sentences", () => {
    // The property in one line: what the resource holds is data that happens to
    // name copy, which is why the config still diffs and snapshots.
    expect(staffResourceConfig.columns.email.header).toBe(
      "staff:columns.email",
    );
    expect(staffResourceConfig.fields.password.description).toBe(
      "staff:fields.password.description",
    );
    expect(staffResourceConfig.grid.hotFilters[0].label).toBe(
      "staff:filters.status",
    );
  });

  it("renders every column header as the catalogue's words", () => {
    renderGrid(withLatvian(), [row]);

    for (const header of [
      "Email",
      "First name",
      "Last name",
      "Roles",
      "Status",
      "Last login",
      "Created",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: new RegExp(header) }),
      ).toBeInTheDocument();
    }
  });

  it("names a hot-filter group and its options from the catalogue", () => {
    renderGrid(withLatvian(), [row]);

    // The group's name is the config's key; the buttons' names come from
    // `common:options`, which is where an enum value's words live because the
    // status *cell* has no config to carry one.
    const group = screen.getByRole("group", { name: "Status filter" });

    expect(group).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Active", pressed: false }),
    ).toBeInTheDocument();
  });

  it("renders the resource's empty message, not the grid's", () => {
    renderGrid(withLatvian(), []);

    expect(screen.getByText("No staff match this view.")).toBeInTheDocument();
  });

  it("moves the translated copy on a locale switch and falls back for the rest", async () => {
    const i18n = withLatvian();

    renderGrid(i18n, []);

    expect(
      screen.getByRole("columnheader", { name: /Email/ }),
    ).toBeInTheDocument();

    await i18n.changeLocale("lv");

    await waitFor(() => {
      expect(
        screen.getByRole("columnheader", { name: /E-pasts/ }),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Neviens darbinieks neatbilst šim skatam."),
    ).toBeInTheDocument();
    /*
     * The untranslated headers stay English through i18next's own fallback,
     * which is the state a partly-translated locale is *supposed* to be in —
     * `D7.6`'s drift check is what makes the gap visible in the gate rather
     * than only on a Latvian operator's screen.
     */
    expect(
      screen.getByRole("columnheader", { name: /First name/ }),
    ).toBeInTheDocument();
  });
});
