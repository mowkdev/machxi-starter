import { useGridDensity } from "@/shared/density";
import { useT } from "@/shared/i18n";
import { Button } from "@/shared/ui";

/**
 * The two density glyphs, drawn here rather than taken from lucide
 * (`D11.12`, ADR-0054 §5).
 *
 * **Bare rules, not boxed rows.** The reference draws density as full-width
 * rules and Columns as a box with two vertical dividers — deliberately not
 * mirror images, because §5 stands the two controls next to each other.
 * `Rows3Icon` beside `Columns3Icon`, which is what `D11.6` shipped, is two
 * identical boxes differing only in the direction of their stripes; at 16px
 * that is no difference at all. `D11.6` could not have seen it, because the
 * pair did not exist until this step made one.
 *
 * **And lucide has no four-rule glyph**, which the first attempt here got
 * wrong: `Menu` is `M4 5h16 / M4 12h16 / M4 19h16` and `AlignJustify` is
 * `M3 5h18 / M3 12h18 / M3 19h18` — the same three rules at the same three
 * heights, one unit of x apart, so the two states would have been visually
 * identical while the record claimed they counted. The review caught it; the
 * fix is to draw the pair, because §5's claim is about the *count* and only
 * an explicit path can hold it.
 *
 * Three rules at 6/12/18 (the reference's own values) and four at 6/10/14/18:
 * same top and bottom, more lines between them, so the glyph says exactly
 * what the mode says. lucide's own geometry otherwise — 24 viewBox, 2px
 * stroke, round caps — so the pair sits at the same weight as the `Columns3`
 * beside it, and `currentColor` so the button's variant still owns the colour.
 */
const RuleGlyph = ({ at }: { readonly at: readonly number[] }) => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    {at.map((y) => (
      <path d={`M3 ${y}h18`} key={y} />
    ))}
  </svg>
);

const ComfortableRows = () => <RuleGlyph at={[6, 12, 18]} />;
const CompactRows = () => <RuleGlyph at={[6, 10, 14, 18]} />;

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

  const Icon = compact ? CompactRows : ComfortableRows;

  return (
    <Button
      type="button"
      /*
       * `outline` since `D11.12`: §5 draws both band controls with a border
       * on `--card`, and a ghost button beside an outlined one reads as a
       * disabled twin rather than as its pair.
       */
      variant="outline"
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
