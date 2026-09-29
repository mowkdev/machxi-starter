import { useGridDensity } from "@repo/app-services";
import { GRID_DENSITIES, type GridDensity } from "@repo/contracts";
import { useKeyT, useT, type TranslationKey } from "@repo/i18n";
import { Rows3Icon, Rows4Icon } from "lucide-react";

import type { PreferenceOptionsControl } from "./options-control";

/**
 * How tightly the rows are packed, listed where a person's preferences are
 * listed (`D11.10`, ADR-0053 §2, ADR-0054 §6) — one card for both apps since
 * `D22.2` (ADR-0077 §2).
 *
 * **This is the inventory, and whether there is a working control beside it
 * is the app's.** The admin keeps `GridDensityControl`, the toggle in the
 * grid's page-header band, and that is not the double entry ADR-0053 §2 argues
 * against: §2's one-inventory rule is about *where a setting is listed*, and
 * the toggle is the working control beside the thing it changes. The customer
 * app has no band and no table to toggle (ADR-0055 §3), so there the
 * inventory is the mode's only surface — a fact held for the account "whether
 * or not a grid is mounted yet", and the card's description, which is the
 * app's own sentence, is where that is said.
 *
 * Every surface writes the same fact through the same path: `setDensity`
 * hands it to ADR-0045's coalescing writer, so a density change beside a
 * theme change is still one `PATCH`.
 *
 * **The two options are the contracts tuple** (ADR-0023), which is what makes
 * a third density a red build here rather than a mode with no control.
 *
 * The icons are the band toggle's own, and deliberately, so a person who has
 * used one surface recognises the other.
 */

const DENSITY_LABEL_KEYS: Record<GridDensity, TranslationKey> = {
  comfortable: "accountClient:preferences.density.comfortable",
  compact: "accountClient:preferences.density.compact",
};

const DENSITY_ICONS: Record<GridDensity, typeof Rows3Icon> = {
  comfortable: Rows3Icon,
  compact: Rows4Icon,
};

export const createGridDensityCards = (Options: PreferenceOptionsControl) => {
  const GridDensityCards = () => {
    const { t } = useT("accountClient");
    const tk = useKeyT();
    const { density, setDensity } = useGridDensity();

    return (
      <Options
        label={t("preferences.density.title")}
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

  return GridDensityCards;
};
