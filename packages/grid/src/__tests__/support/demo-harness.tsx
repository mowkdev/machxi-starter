import {
  listQuerySearchSchema,
  type ListQuerySearch,
  type Page,
} from "@repo/contracts";
import type {
  ColumnOverrides,
  GridCapabilities,
  HotFilterConfig,
} from "@repo/resource";
import { screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { AppGrid } from "../../app-grid";
import type { PreferenceStorage } from "../../preferences";
import type { GridMeta, GridToolbarContext } from "../../types";
import { KEY_PREFIX, createTestI18n } from "./demo-i18n";
import { demoResourceConfig, type DemoRow } from "./demo-resource";

/**
 * The grid, rendered entirely from the demo config (ADR-0035, `D3.6`).
 *
 * User-centric per ADR-0036: query by role and accessible name, drive with
 * `user-event`, assert what an operator sees. The role queries work directly
 * because the grid renders a real semantic `<table>` — the accessibility
 * posture and the testing posture are the same posture.
 *
 * **One harness for five files since `D22.3`** (ADR-0077 §4). The admin's
 * `shared/grid/__tests__/app-grid.test.tsx` was one 1,839-line file that
 * reached this package through the door; it moved here and was split by
 * concern as it landed — the shell and the pager, the header dialogs, the
 * applied and hot filters, selection with the toolbar, and the column
 * preferences — and every one of them asks its question of this grid. What
 * the door binds (the device-key prefix, the density hook, the error panel)
 * is passed here as the plain values an app would bind, and the admin keeps
 * the one test that proves its binding.
 */

export const base = listQuerySearchSchema.parse({});

export const pageOf = (
  rows: readonly DemoRow[],
  overrides: Partial<Page<DemoRow>> = {},
): Page<DemoRow> => ({
  items: rows,
  total: rows.length,
  offset: 0,
  limit: 20,
  sort: [],
  filters: {},
  ...overrides,
});

export interface HarnessProps {
  readonly page?: Page<DemoRow>;
  readonly initial?: ListQuerySearch;
  readonly meta?: GridMeta<DemoRow>;
  readonly onChange?: (next: ListQuerySearch) => void;
  readonly searchable?: boolean;
  readonly hotFilters?: readonly HotFilterConfig[];
  readonly overrides?: ColumnOverrides;
  readonly gridId?: string;
  readonly storage?: PreferenceStorage;
  readonly capabilities?: GridCapabilities;
  readonly createAction?: ReactNode;
  readonly onBulkDelete?: (
    ids: readonly string[],
    context: GridToolbarContext,
  ) => void;
  readonly toolbarStart?: ReactNode;
  readonly toolbarEnd?: ReactNode;
  readonly renderToolbar?: (context: GridToolbarContext) => ReactNode;
}

/**
 * The grid with its state where the app keeps it.
 *
 * The URL is the state (ADR-0034), so a test that held it anywhere else would
 * be testing a different component. `onChange` is the spy; the state below
 * stands in for the route's search params.
 */
export const Harness = ({
  page,
  initial = base,
  meta,
  onChange,
  searchable = false,
  hotFilters,
  overrides,
  gridId,
  storage,
  capabilities,
  createAction,
  onBulkDelete,
  toolbarStart,
  toolbarEnd,
  renderToolbar,
}: HarnessProps) => {
  const [listState, setListState] = useState(initial);
  /*
   * The grid's chrome speaks keys since `D7.2`, so the harness mounts an
   * instance of its own — `en`, loaded synchronously, which is why every
   * assertion in these files is still by the English accessible name it was
   * written with (ADR-0046 §14). One per mounted harness, from the same factory
   * an app uses, so no case inherits another's language.
   */
  const [i18n] = useState(createTestI18n);

  return (
    <I18nextProvider i18n={i18n.instance}>
      <AppGrid<DemoRow>
        keyPrefix={KEY_PREFIX}
        renderError={() => <p>Failed</p>}
        columns={demoResourceConfig.columns}
        overrides={overrides}
        page={page}
        listState={listState}
        searchable={searchable}
        hotFilters={hotFilters}
        gridId={gridId}
        preferenceStorage={storage}
        meta={meta}
        capabilities={capabilities}
        createAction={createAction}
        onBulkDelete={onBulkDelete}
        toolbarStart={toolbarStart}
        toolbarEnd={toolbarEnd}
        renderToolbar={renderToolbar}
        getRowId={(row) => row.id}
        onListStateChange={(next) => {
          setListState(next);
          onChange?.(next);
        }}
      />
    </I18nextProvider>
  );
};

/** Every affordance on, for the tests that are about what a *role* removes. */
export const ALL: GridCapabilities = {
  selectable: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canBulkDelete: true,
};

/**
 * Opens one column's filter dialog and hands back its scope.
 *
 * The name is matched by prefix because the icon carries its active state in
 * its accessible name — "Filter by Name" when clear, "Filter by Name
 * (filtered)" when the URL says otherwise — which is the one thing a screen
 * reader can hear about a column that is already narrowing the list.
 */
export const openFilterDialog = async (
  user: ReturnType<typeof userEvent.setup>,
  column: string,
) => {
  await user.click(
    screen.getByRole("button", { name: new RegExp(`^Filter by ${column}`) }),
  );

  return within(await screen.findByRole("dialog"));
};
