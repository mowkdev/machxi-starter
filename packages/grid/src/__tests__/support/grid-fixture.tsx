import type { ListQuerySearch, Page } from "@repo/contracts";

import type { ColumnConfigMap } from "@repo/resource";

import { AppGrid } from "../../app-grid";
import { renderWithI18n } from "./render";

/**
 * The one grid every `app-grid*` case renders (`D20.7`).
 *
 * The suite that used to be one file is three — the shell, the header and the
 * body, beside the three source files `app-grid.tsx` became — and all three
 * ask the *same* grid the same kind of question, so the fixture is shared
 * rather than copied. A second copy of `ROWS` or `LIST_STATE` would be a
 * second thing to keep honest, and a case whose expected row count silently
 * disagreed with its page is the failure this module removes.
 */

export interface Row {
  readonly id: string;
  readonly email: string;
}

/** The density block's fixture: one prose column and one badge column. */
export interface RoleRow extends Row {
  readonly roles: readonly string[];
}

export const ROWS: readonly Row[] = [
  { id: "1", email: "ada@machxi.local" },
  { id: "2", email: "mo@machxi.local" },
  { id: "3", email: "sam@machxi.local" },
];

export const COLUMNS: ColumnConfigMap = {
  email: { header: "grid:filter.title" },
};

export const LIST_STATE: ListQuerySearch = {
  offset: 0,
  limit: 20,
  sort: [],
  filters: [],
  count: true,
};

export const page: Page<Row> = {
  items: ROWS,
  total: ROWS.length,
  offset: 0,
  limit: 20,
  sort: [],
  filters: {},
};

export const renderGrid = (striped?: boolean) =>
  renderWithI18n(
    <AppGrid
      keyPrefix="machxi.admin"
      columns={COLUMNS}
      listState={LIST_STATE}
      page={page}
      renderError={() => <p>Failed</p>}
      onListStateChange={() => {
        /* the URL round trip is `list-state`'s own suite */
      }}
      {...(striped === undefined ? {} : { striped })}
    />,
  );

export const COLUMNS_WITH_ROLES: ColumnConfigMap = {
  email: { header: "grid:filter.title", mono: true },
  roles: { header: "grid:columns.label", cellRenderer: "rolesList" },
};

export const rolePage: Page<RoleRow> = {
  ...page,
  items: ROWS.map((row) => ({ ...row, roles: ["admin"] })),
};

export const renderAt = (density?: "comfortable" | "compact") =>
  renderWithI18n(
    <AppGrid
      keyPrefix="machxi.admin"
      columns={COLUMNS_WITH_ROLES}
      listState={LIST_STATE}
      page={rolePage}
      renderError={() => <p>Failed</p>}
      onListStateChange={() => {
        /* not this suite's question */
      }}
      {...(density === undefined ? {} : { density })}
    />,
  );
