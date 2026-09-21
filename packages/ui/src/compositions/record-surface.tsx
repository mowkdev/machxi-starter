import type { ReactElement, ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Card } from "@repo/ui/components/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/components/sheet";
import { cn } from "@repo/ui/lib/utils";

/**
 * One content-agnostic record container in three variants (ADR-0048 §4).
 *
 * Fixed header, scrolling body, fixed footer — the shape `apps/admin`'s three
 * form shells each built separately and two of them got wrong: the drawer put
 * `overflow-y-auto` on the whole `SheetContent` with the header inside it, so
 * a long form scrolled its own title away, and the footer went with it.
 *
 * **Geometry only** (ADR-0047 §What-code): no `react-hook-form`, no
 * `@tanstack/react-router`, no `@repo/contracts`. The form-state reads and the
 * navigation blocker stay in the consuming app as thin wrappers, which is what
 * keeps this package form-engine-agnostic and routing-blind.
 *
 * ## The inversion
 *
 * The `<form>` must wrap header, body and footer with only the body scrolling
 * — that is what makes a `type="submit"` button work in a *fixed* footer and
 * lets the footer read form state through context. But it fights the
 * primitives' own layout: `DialogContent` is `grid … gap-4 p-6` and
 * `SheetContent` is `flex flex-col gap-4`, both laying out their *direct*
 * children, so wrapping collapses them to a single child — and that child is
 * the element that must carry the row template and the body's `min-h-0`.
 *
 * So the container does not supply that element; it **asks for it**.
 * {@link RecordSurfaceProps.column} is called with the container's geometry
 * classes and its three rows, and the app returns its `<form>`. With no
 * `column` given the container renders its own `div` — the detail-view and
 * long-confirmation case, neither of which hands it a form at all.
 *
 * **A render prop, not `asChild`.** Every `asChild` in this package is Radix
 * `Slot.Root`, which clones its single child and merges props onto it — it
 * does **not** render the parent's own children inside it. That would need
 * `Slot.Slottable`, which appears nowhere here and would be a new convention
 * bought for one call site; and what the app hands over is a component rather
 * than a DOM node, so a clone would have to be trusted to forward `className`.
 * A render prop states both obligations in the type and needs no convention.
 *
 * ## Why `page` has no scroll element
 *
 * Not a carve-out for tidiness. A routed `page` surface renders under
 * `fullHeight: false`, so ADR-0037's chain gives it neither `h-svh` on the
 * inset nor `min-h-0` on the page container — and an `overflow-y-auto min-h-0`
 * body inside an unbounded parent is inert. It would scroll nothing, fix
 * nothing, and jsdom would never say so. Under `page` the document scrolls, as
 * it does today, and the shell's `<h1>` carries the record's title (§2), so
 * this variant renders no heading of its own.
 *
 * ## The band anatomy (`D11.5`, ADR-0054 §7)
 *
 * The three rows are **bands**: a 60px title bar closed by a rule, a 24px body
 * holding a 20px field stack, and a 64px footer on `--muted` under a rule of
 * its own. They run edge to edge, so the frames give up the padding they used
 * to supply (`DialogContent`'s `p-6`, `Card`'s `py-6`, the column's `px-6`)
 * and each band carries its own gutters — the same division `D11.3` made on
 * the shell when the page container went full-bleed. The three variants are
 * siblings in the reference and are siblings here: one title bar, one body,
 * one footer.
 *
 * They differ in exactly two things beyond the frame, both of them the `page`
 * variant's and both decided by ADR-0048 §2 rather than by this record: it
 * renders **no title bar**, because the shell's `<h1>` and its page-header
 * band are the page's title and a second heading with one name is the defect
 * `D4.2` found; and its `description` therefore renders as a **lede** at the
 * top of the body, at §3's 14/20 body rung rather than the 12px meta rung a
 * title bar's second line takes.
 */

export type RecordSurfaceVariant = "dialog" | "drawer" | "page";

export type RecordSurfaceSize = "sm" | "md" | "lg" | "xl" | "full";

/**
 * Per variant, per token, one class string merged through `cn`.
 *
 * **Written with the `sm:` modifier** because the primitives' own caps are
 * (`DialogContent`'s `sm:max-w-lg`, `SheetContent`'s `sm:max-w-sm`) and
 * `tailwind-merge` will not drop a prefixed class in favour of an unprefixed
 * one. Both primitives already merge `className`, so sizes cost **zero**
 * generated-file edits.
 *
 * The `dialog` row carries two classes beyond the width, on every token:
 *
 * - `max-h-[calc(100svh-2rem)]` because `DialogContent` carries **no `max-h`
 *   at all** — it is centred by transform — so a bound on the inner column
 *   would bound nothing and the modal would grow past the viewport while its
 *   body scrolled inside the padding. It matches the `max-w-[calc(100%-2rem)]`
 *   gutter the primitive already has.
 * - `grid-rows-[minmax(0,1fr)]` because `DialogContent` is `grid` and its
 *   implicit row track is `auto`, which sizes to the column's content rather
 *   than shrinking to the container's `max-height` the way a flex child does.
 *   Without it the column's `1fr` body row resolves against content height and
 *   `overflow-y-auto` never engages. This is the class that makes the parent's
 *   bound actually reach the column.
 *
 * The `drawer` needs neither: `SheetContent` is `flex flex-col` on a definite
 * `inset-y-0 h-full` for the `left`/`right` sides this variant uses, so its
 * child shrinks by default.
 *
 * **`dialog`/`md` is 600px since `D11.5`** (ADR-0054 §7), which is the one
 * width the redesign moves: the reference draws the dialog at 600, the drawer
 * at 512 and the page card at 672, and the latter two are already what
 * `sm:max-w-lg` and `max-w-2xl` resolve to. It is a bracket value rather than a
 * scale step because Tailwind's ladder has nothing at 600 — `lg` is 512 and
 * `2xl` is 672 — and the ladder stays monotone across the five tokens either
 * way.
 */
const SIZES: Record<RecordSurfaceVariant, Record<RecordSurfaceSize, string>> = {
  dialog: {
    sm: "sm:max-w-sm",
    md: "sm:max-w-[600px]",
    lg: "sm:max-w-2xl",
    xl: "sm:max-w-4xl",
    full: "sm:max-w-[calc(100%-2rem)]",
  },
  drawer: {
    sm: "w-full sm:max-w-sm",
    md: "w-full sm:max-w-lg",
    lg: "w-full sm:max-w-2xl",
    xl: "w-full sm:max-w-4xl",
    full: "w-full sm:max-w-none",
  },
  page: {
    sm: "max-w-md",
    md: "max-w-2xl",
    lg: "max-w-4xl",
    xl: "max-w-6xl",
    full: "max-w-none",
  },
};

/** The viewport bound and the track that lets it reach the column. */
const DIALOG_BOUND = "max-h-[calc(100svh-2rem)] grid-rows-[minmax(0,1fr)]";

/**
 * The dialog's frame, made band-ready (`D11.5`, ADR-0054 §7).
 *
 * Three classes, each undoing something `DialogContent` supplies that a band
 * layout cannot have. `p-0` because the bands run **edge to edge** — the
 * primitive's `p-6` would inset the title rule and the footer's ground by
 * 24px, which is the "a full-bleed container leaves each band to carry its
 * own gutter" lesson `D11.3` learned on the shell. `gap-0` because the column
 * is the primitive's only child and a 1rem row gap between three bands is a
 * seam where the reference draws none. `rounded-xl` is §2's radius assignment
 * arriving where the record says it does: the token sheet ships the 4·5·6·8
 * scale, the surface that owns the shape spells which rung it takes, and the
 * dialog's is 8 — the generated primitive's own `rounded-lg` is 6.
 *
 * **`overflow-hidden` is load-bearing, not tidiness.** The footer band paints
 * `--muted` to the frame's edge; without it the ground squares off the two
 * bottom corners the `rounded-xl` just rounded, and the effect reads as a
 * rendering bug rather than as a choice.
 */
const DIALOG_FRAME = "gap-0 overflow-hidden rounded-xl p-0";

/**
 * The page card's frame, for the reasons {@link DIALOG_FRAME} gives.
 *
 * `Card` is `flex flex-col gap-6 rounded-xl border bg-card py-6`: the radius
 * is already §7's 8, the gap is inert under the inversion (the column is the
 * card's only child) and the `py-6` is what has to go, because the title's
 * distance is the shell's band above and the footer's is its own.
 */
const PAGE_FRAME = "w-full gap-0 overflow-hidden p-0";

/**
 * The inner column's own classes.
 *
 * `grid-rows-[auto_1fr_auto]` because the primitives lay out their direct
 * children and the column is now the only one; `min-h-0` so the `1fr` body row
 * may shrink below its content, which is what lets `overflow-y-auto` on that
 * row scroll instead of growing the box. The template is **gapless** because
 * the three rows are now bands: each carries its own height, gutters and rule,
 * and a row gap would open a stripe of card between two surfaces that are
 * meant to meet. Under `page` there is no scroll row, so the column is plain
 * flex — and it carries no gutter of its own since `D11.5`, because the bands
 * took theirs.
 *
 * **`flex-1` on the drawer, and it is `D11.5`'s bill for making the footer
 * visible.** `SheetContent` is `flex flex-col` on a definite `inset-y-0
 * h-full`, and a flex child defaults to `flex: 0 1 auto` — it *shrinks* when
 * the content overflows, which is why a long form has always scrolled here,
 * but it never *grows*. So on a short form the column ended where the last
 * field did, hundreds of pixels above the drawer's bottom edge. That was
 * invisible while the footer had no ground of its own; a 64px `--muted` band
 * floating mid-drawer is not, and §7's own words for this variant are
 * "full-height … with the body scrolling between static bands". `flex-1`
 * makes the column the drawer's height, and the `min-h-0` beside it is what
 * still lets the `1fr` body row shrink and scroll. The dialog needs no
 * equivalent: its parent is a grid whose `grid-rows-[minmax(0,1fr)]` track
 * stretches the column already.
 */
const COLUMN = {
  dialog: "grid min-h-0 grid-rows-[auto_1fr_auto]",
  drawer: "grid min-h-0 flex-1 grid-rows-[auto_1fr_auto]",
  page: "flex flex-col",
} as const;

/**
 * The title bar — the first band (`D11.5`, ADR-0054 §7).
 *
 * 60px holding a 16/22 title over a 12px meta line, gutters matching the
 * body's 24, and a rule closing it against what scrolls beneath.
 *
 * **A floor, not a height** — `min-h-15` rather than `h-15` — which is the
 * rule `D11.4` wrote for the grid's three bands and which applies here for a
 * sharper reason: a record's title is data (`recordLabel` is an email on both
 * shipped record routes), and a fixed height on a band holding a string of
 * unknown length is a band that clips it. `justify-center` is what puts one
 * line in the middle of the 60 and lets two lines grow past it symmetrically,
 * and `py-2` is the padding that keeps the grown case off the rule.
 *
 * **`p-0` first, and it is doing work**: `SheetHeader` is self-padded (`p-4`)
 * while `DialogHeader` has no padding at all, so the two would land at
 * different gutters from the same constant. `p-0` and `px`/`py` are the same
 * tailwind-merge group as `p-4`'s and therefore displace it, which an
 * unprefixed `px-6` alone would not do.
 *
 * **The rule is this step's one addition to §7**, and it is recorded there
 * rather than smuggled: the record names the footer's `--muted` ground and top
 * rule and gives the title bar only its height and type. A body that scrolls
 * *between* two static bands needs the upper one bounded, or content slides
 * under a title with no edge to slide under.
 */
const TITLE_BAND =
  "flex min-h-15 flex-col justify-center gap-0.5 border-b p-0 px-6 py-2 text-left";

/** 16/22·600 — §3's card/dialog title rung, over §7's 12px meta line. */
const TITLE_TYPE = "text-base leading-[22px] font-semibold";
const META_TYPE = "text-xs leading-4";

/**
 * The body — 24px on every side, in all three variants (ADR-0054 §7).
 *
 * It replaces three different answers: the drawer's `px-4` gutters (which
 * `SheetContent` supplies none of), the dialog's inherited `p-6` from the
 * primitive it just lost, and the page's `px-6` on the column. One number,
 * because the three surfaces are siblings in the reference and a form that
 * changes its margins when a config line changes is the drift ADR-0040 exists
 * to prevent.
 *
 * **It also retires the dialog's `p-1 -m-1` paint room** (`D8.11`). That
 * existed because a scrolling body clips ink overflow at its padding box and a
 * `w-full` field sat exactly on that edge, so `Input`'s
 * `focus-visible:ring-[3px]` was shaved off. With 24px of padding the ring has
 * eight times the room it needs, and the cancelled-out hack is dead weight
 * rather than a fix.
 */
const BODY_BAND = "p-6";

/**
 * The footer — the third band (`D11.5`, ADR-0054 §7).
 *
 * 64px on `--muted` under a top rule, holding Cancel and the primary. A floor
 * again, and this one is exercised below `sm`: the dialog's footer is
 * `flex-col-reverse` there, so the two controls stack and the band grows to
 * hold them rather than clipping the one an operator came for.
 *
 * The band is `flex items-center` and nothing else — the *arrangement* of the
 * actions belongs to whoever passes the slot, which is what keeps this
 * container content-agnostic (a detail view's footer is not two buttons).
 */
const FOOTER_BAND = "flex min-h-16 items-center border-t bg-muted px-6 py-2";

export interface RecordSurfaceColumnProps {
  readonly className: string;
  readonly children: ReactNode;
}

export interface RecordSurfaceProps {
  readonly variant: RecordSurfaceVariant;
  readonly size?: RecordSurfaceSize;
  /**
   * The fixed header's title. A real heading under `dialog` and `drawer`;
   * under `page` it is not rendered at all, because the shell's `<h1>` carries
   * the record's label there and two headings with one name is the defect
   * `D4.2` found by testing the shells against each other.
   */
  readonly title: string;
  readonly description?: string;
  /** The fixed footer — a slot, not a fixed set of actions. */
  readonly footer?: ReactNode;
  /**
   * The controlled mount, for the deliberately non-routed ceremonies. Omitted
   * for the routed mount, which is always open and closes by navigating.
   */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /**
   * `false` refuses dismissal — Escape, overlay click and the close button
   * alike — which is how a wrapper says a mutation is in flight (ADR-0035's
   * submit lock, ADR-0044's in-flight rule).
   */
  readonly dismissible?: boolean;
  /**
   * The inversion (ADR-0048 §4). Called with the container's geometry classes
   * and its three rows; the app returns the element that wraps them — its
   * `<form>`. Omitted → the container renders its own `div`.
   */
  readonly column?: (props: RecordSurfaceColumnProps) => ReactElement;
  /** The scrolling body, under `dialog` and `drawer`. */
  readonly children: ReactNode;
}

export const RecordSurface = ({
  variant,
  size = "md",
  title,
  description,
  footer,
  open,
  onOpenChange,
  dismissible = true,
  column,
  children,
}: RecordSurfaceProps) => {
  const scrolls = variant !== "page";

  const rows = (
    <>
      {variant === "dialog" ? (
        <DialogHeader className={TITLE_BAND}>
          <DialogTitle className={TITLE_TYPE}>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription className={META_TYPE}>
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
      ) : null}
      {variant === "drawer" ? (
        <SheetHeader className={TITLE_BAND}>
          <SheetTitle className={TITLE_TYPE}>{title}</SheetTitle>
          {description === undefined ? null : (
            <SheetDescription className={META_TYPE}>
              {description}
            </SheetDescription>
          )}
        </SheetHeader>
      ) : null}

      <div
        className={cn(scrolls && "min-h-0 overflow-y-auto", BODY_BAND)}
        data-slot="surface-body"
      >
        {/*
         * **The page variant's description is a lede inside the body, not a
         * band of its own** (`D11.5`). The other two put it on the title bar's
         * meta line; `page` has no title bar, because the shell's `<h1>` and
         * its page-header band are the page's title (ADR-0048 §2, and §5's
         * band above the container since `D11.3`) and a second heading with
         * one accessible name is the defect `D4.2` found. So the line lands
         * where the body's own 24px gutter reaches it, spaced from the first
         * field by §7's 20px field stack.
         */}
        {variant === "page" && description !== undefined ? (
          <p
            className="mb-5 text-sm text-muted-foreground"
            data-slot="surface-lede"
          >
            {description}
          </p>
        ) : null}
        {children}
      </div>

      {footer === undefined ? null : (
        <div className={FOOTER_BAND} data-slot="surface-footer">
          {footer}
        </div>
      )}
    </>
  );

  const columnClassName = COLUMN[variant];
  const inner = column?.({ className: columnClassName, children: rows }) ?? (
    <div className={columnClassName} data-slot="surface-column">
      {rows}
    </div>
  );

  /*
   * `dismissible={false}` refuses all three routes out — Escape, the overlay,
   * and the primitive's own corner button — rather than only hiding the
   * button, because an operator who presses Escape mid-mutation is asking the
   * same question the button asks.
   */
  /*
   * Spread rather than passed as `onOpenChange={…}`: under
   * `exactOptionalPropertyTypes` an explicit `undefined` is not the same as an
   * absent prop, and the root's type says the prop may be absent, not that it
   * may be `undefined`. While a mutation is in flight it is withheld
   * entirely — a root that still reported closes would leave the refusal to
   * the wrapper.
   */
  const controlled =
    dismissible && onOpenChange !== undefined ? { onOpenChange } : {};

  const refuse = dismissible
    ? undefined
    : {
        onEscapeKeyDown: (event: KeyboardEvent) => {
          event.preventDefault();
        },
        onPointerDownOutside: (event: Event) => {
          event.preventDefault();
        },
        onInteractOutside: (event: Event) => {
          event.preventDefault();
        },
      };

  if (variant === "dialog") {
    return (
      <Dialog open={open ?? true} {...controlled}>
        <DialogContent
          className={cn(DIALOG_BOUND, DIALOG_FRAME, SIZES.dialog[size])}
          showCloseButton={dismissible}
          {...refuse}
        >
          {inner}
        </DialogContent>
      </Dialog>
    );
  }

  if (variant === "drawer") {
    return (
      <Sheet open={open ?? true} {...controlled}>
        <SheetContent
          className={cn(SIZES.drawer[size])}
          showCloseButton={dismissible}
          side="right"
          {...refuse}
        >
          {inner}
        </SheetContent>
      </Sheet>
    );
  }

  /*
   * The `Card` shape the page shell has today (ADR-0048 §4), not a bare box.
   * The variant renders neither a Dialog nor a Sheet, so it supplies its own
   * element — and if that element were a plain `div`, adopting this container
   * would silently strip the border, background, shadow and vertical rhythm
   * from the shipped page surface, which is a visual regression no test in
   * either suite could see.
   *
   * **Since `D11.5` the card is a frame and nothing else** (ADR-0054 §7): its
   * `py-6` and its inert `gap-6` go, and the gutters live on the bands, so the
   * page reads as the same three-band surface the dialog and the drawer do.
   * The column carries no padding of its own — an element between the card and
   * the rows would collapse the layout the same way wrapping collapses the
   * modal primitives', which is why the bands rather than a wrapper hold it.
   */
  return (
    <Card
      className={cn(PAGE_FRAME, SIZES.page[size])}
      data-slot="record-surface"
      data-variant="page"
    >
      {inner}
    </Card>
  );
};
