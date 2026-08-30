import { Rows3Icon, Rows4Icon } from "lucide-react";

import { useGridDensity } from "@/shared/density";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui";

/**
 * How tightly the rows are packed, switched from the page-header band
 * (`D11.6`, ADR-0053 §2, ADR-0054 §6).
 *
 * A feature, for the reason `features/theme` is one: it is an interaction that
 * changes something about the operator's own account. It renders a control and
 * nothing about where that control hangs — the `_dashboard` route file puts it
 * in `AppShell`'s `pageActions` slot, which is the same division that let
 * `D8.5` move the account menu into the header without touching the theme
 * items.
 *
 * **A toggle, not a menu, because the mode is two values** (ADR-0054 §6). So
 * it is a pressed-state button rather than a radio group: `aria-pressed` says
 * which of the two is on, the accessible name stays put — a control that
 * renamed itself on each click is a control a screen-reader user cannot find
 * twice — and the icon is the only thing that changes with the state. The
 * Preferences card `D11.10` builds is the same fact's second surface, over the
 * same `setDensity`; ADR-0053 §2's one-inventory rule is about *where a
 * setting is listed*, and this is the working control beside the thing it
 * changes.
 *
 * 34 × 34 is the record's number, and the band's: `size="icon"` is the
 * primitive's 36, so the size is spelled here — the one value this component
 * carries, which §2 permits because only the element that draws it can.
 */
export const GridDensityControl = () => {
  const { t } = useT("settings");
  const { density, setDensity } = useGridDensity();

  const compact = density === "compact";
  const Icon = compact ? Rows4Icon : Rows3Icon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-[34px]"
      aria-pressed={compact}
      aria-label={t("density.toggle")}
      onClick={() => {
        setDensity(compact ? "comfortable" : "compact");
      }}
    >
      <Icon />
    </Button>
  );
};
