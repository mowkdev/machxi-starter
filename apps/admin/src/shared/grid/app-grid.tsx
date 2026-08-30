import {
  AppGrid as AppGridBase,
  type AppGridProps as AppGridBaseProps,
} from "@repo/grid";

import { useGridDensityValue } from "@/shared/density";
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
 *
 * **The density is bound here too** (`D11.6`, ADR-0053 §2, ADR-0054 §6). The
 * package takes it as a prop because it may not know a settings resource
 * exists; the account fact is one thing, so every grid in this app has to read
 * the same one, and a prop each page remembered to pass would be a mode that
 * worked on one screen. Reading it once at the door is the same move the error
 * panel makes and leaves the two grid pages untouched.
 *
 * It is the **value** hook, not the view: a table with no provider above it
 * renders comfortable rather than throwing, because a table is allowed to
 * exist without an account. The control that *writes* the mode is the one
 * that may not (`features/density`).
 */

export type AppGridProps<TRow> = Omit<
  AppGridBaseProps<TRow>,
  "renderError" | "density"
>;

export const AppGrid = <TRow,>(props: AppGridProps<TRow>) => {
  const density = useGridDensityValue();

  return (
    <AppGridBase
      {...props}
      density={density}
      renderError={({ error, onRetry }) => (
        <QueryError error={error} onRetry={onRetry} />
      )}
    />
  );
};
