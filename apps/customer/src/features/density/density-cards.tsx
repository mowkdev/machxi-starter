import { GRID_DENSITIES, type GridDensity } from "@repo/contracts";
import { Rows3Icon, Rows4Icon } from "lucide-react";

import { useGridDensity } from "@/shared/density";
import { useKeyT, useT, type TranslationKey } from "@/shared/i18n";
import { SettingsOptions } from "@/shared/ui";

/**
 * How tightly the rows are packed, listed where the customer's preferences are
 * listed (`D12.7`; ADR-0053 §2, ADR-0054 §6, ADR-0055 §3).
 *
 * **The mode's only surface in this app, and the one it does not have is the
 * working control.** In the admin this card is the *inventory* and the toggle
 * in the grid's page-header band is the control beside the thing it changes;
 * here ADR-0055 §3 keeps `@repo/grid` out until a domain entity arrives, so
 * there is no band and no table to toggle. What ships is the inventory alone.
 *
 * That makes this the one preference on the page whose effect a customer cannot
 * see, and the copy says so rather than pretending otherwise — ADR-0055 §3
 * decided the fact is worth holding anyway ("an account fact whether or not a
 * grid is mounted yet"), because a customer who chooses Compact chooses it for
 * the app and the choice has to survive until there is something to spend it
 * on. The card's description is where that honesty lives; the alternative was a
 * control that silently does nothing, which is worse than one that says what it
 * is for.
 *
 * Both halves write the same fact through the same path as the theme:
 * `setDensity` hands it to ADR-0045's coalescing writer, so a density change
 * and a theme change in one second are one `PATCH`.
 *
 * **The two options are the contracts tuple** (ADR-0023), which is what makes a
 * third density a red build here rather than a mode with no control. The icons
 * are the admin band toggle's own, so a person who meets both surfaces later
 * recognises the second.
 */

const DENSITY_LABEL_KEYS: Record<GridDensity, TranslationKey> = {
  comfortable: "settings:density.comfortable",
  compact: "settings:density.compact",
};

const DENSITY_ICONS: Record<GridDensity, typeof Rows3Icon> = {
  comfortable: Rows3Icon,
  compact: Rows4Icon,
};

export const GridDensityCards = () => {
  const { t } = useT("settings");
  const tk = useKeyT();
  const { density, setDensity } = useGridDensity();

  return (
    <SettingsOptions
      label={t("density.title")}
      layout="cards"
      name="gridDensity"
      onChange={setDensity}
      options={GRID_DENSITIES.map((option) => ({
        value: option,
        label: tk(DENSITY_LABEL_KEYS[option]),
        icon: DENSITY_ICONS[option],
      }))}
      value={density}
    />
  );
};
