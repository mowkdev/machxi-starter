import {
  AppGrid as AppGridBase,
  type AppGridProps as AppGridBaseProps,
} from "@repo/grid";

import { QueryError } from "@/shared/ui";

/**
 * The door onto `@repo/grid`'s table — and the one file in this slice that is
 * more than a re-export (`D9.4`, ADR-0051).
 *
 * **The error panel is this app's, so the door supplies it.** `AppGrid` used
 * to render `QueryError` directly; that component turns an unknown into a
 * sentence through `shared/notifications` and the `errors` catalogue, both of
 * which belong to this app (ADR-0046 §13, ADR-0043). The package therefore
 * takes a `renderError` slot and requires it — a grid that swallowed a refused
 * list and showed an empty table is the failure ADR-0043 built the panel to
 * prevent, so a second consumer must answer it rather than inherit a silent
 * default.
 *
 * Binding it here rather than at each call site is what keeps `AppGrid`
 * meaning the same thing everywhere in this app: the two grid screens and
 * every suite that mounts one are untouched by the extraction. It is the same
 * shape `shared/i18n`'s door uses for `createI18n` (`D9.2`).
 */

export type AppGridProps<TRow> = Omit<AppGridBaseProps<TRow>, "renderError">;

export const AppGrid = <TRow,>(props: AppGridProps<TRow>) => (
  <AppGridBase
    {...props}
    renderError={({ error, onRetry }) => (
      <QueryError error={error} onRetry={onRetry} />
    )}
  />
);
