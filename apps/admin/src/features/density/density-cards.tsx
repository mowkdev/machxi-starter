import { GRID_DENSITIES, type GridDensity } from "@repo/contracts";
import { Rows3Icon, Rows4Icon } from "lucide-react";

import { useGridDensity } from "@/shared/density";
import { useKeyT, useT, type TranslationKey } from "@/shared/i18n";
import { SettingsOptions } from "@/shared/ui";

/**
 * How tightly the rows are packed, listed where the operator's preferences are
 * listed (`D11.10`, ADR-0053 §2, ADR-0054 §6).
 *
 * **The mode's second surface, and the first one is not retired.**
 * `GridDensityControl` — the toggle in the grid's page-header band — goes on
 * shipping, and that is not the double entry ADR-0053 §2 argues against: §2's
 * one-inventory rule is about *where a setting is listed*, and the toggle is
 * the working control beside the thing it changes. What the menu had, and what
 * this section is, is the inventory. The theme and the language are the same
 * fact from the other end — they had a menu and now have a card, and neither
 * has a working control beside anything.
 *
 * Both surfaces write the same fact through the same path: `setDensity` hands
 * it to ADR-0045's coalescing writer, so a density change beside a theme
 * change is still one `PATCH`.
 *
 * **The two options are the contracts tuple** (ADR-0023), which is what makes
 * a third density a red build here rather than a mode with no control.
 *
 * The icons are the toggle's own, and deliberately: `Rows3Icon` is what the
 * band shows while Comfortable is in force and `Rows4Icon` while Compact is,
 * so an operator who has used one surface recognises the other.
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
