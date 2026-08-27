"use client";

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
 * child shrinks by default. `md` maps to the shipped `sm:max-w-lg` for the
 * dialog and `w-full sm:max-w-lg` for the drawer, and `page`/`md` to the
 * `max-w-2xl` the shipped page shell hardcodes — so no shipped width moves.
 */
const SIZES: Record<RecordSurfaceVariant, Record<RecordSurfaceSize, string>> = {
  dialog: {
    sm: "sm:max-w-sm",
    md: "sm:max-w-lg",
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
 * The inner column's own classes.
 *
 * `grid-rows-[auto_1fr_auto]` because the primitives lay out their direct
 * children and the column is now the only one; `min-h-0` so the `1fr` body row
 * may shrink below its content, which is what lets `overflow-y-auto` on that
 * row scroll instead of growing the box. The template is deliberately
 * **gapless**, but for a narrower reason than an earlier draft gave: the
 * fields-to-footer distance is already carried whole by the app's own footer
 * margin, so a row gap would double it. Where a header-to-body distance
 * *does* ship it is restored on the header row instead — see
 * {@link DIALOG_HEADER}. Under `page` there is no scroll row, so the column is
 * plain flex.
 */
const COLUMN = {
  dialog: "grid min-h-0 grid-rows-[auto_1fr_auto]",
  drawer: "grid min-h-0 grid-rows-[auto_1fr_auto]",
  // `px-6` is `CardContent`'s contribution, applied to the column because the
  // column is the `Card`'s only direct child under the inversion.
  page: "flex flex-col px-6",
} as const;

/**
 * `SheetContent` supplies no gutters and `SheetHeader` is self-padded (`p-4`),
 * so the body and footer rows carry their own — **both**, because gutters on
 * the body alone would leave the footer's actions flush to the drawer's edge.
 */
const DRAWER_BODY = "px-4";
const DRAWER_FOOTER = "px-4 pb-4";

/**
 * The one distance the wrap takes away from the `dialog` variant, restored on
 * the row that lost it (`D8.11`, ADR-0048 §4).
 *
 * `DialogContent` is `grid … gap-4 p-6` and its children were the header and
 * the form; after the inversion the column is its only child, so that `gap-4`
 * goes inert exactly the way `FieldSet`'s `gap-6` does — and it was the
 * header-to-fields distance. `DialogHeader` has no padding of its own, so
 * without this the title sits flush against the first field.
 *
 * **The two shells that adopted the container first did not need it, which is
 * why the rule was written the other way round.** The shipped drawer set
 * `gap-0` on `SheetContent` and let `SheetHeader`'s own `p-4` do the work, and
 * the `page` variant's lede carries `mb-6`. The dialog is the one shell where
 * a header gap really does ship, and it is a margin on the header rather than
 * a gap on the row template because the template's other seam —
 * fields-to-footer — is already carried whole by the app's `mt-12`.
 */
const DIALOG_HEADER = "mb-4";

/**
 * Paint room for the focus ring, cancelled out so nothing moves (`D8.11`).
 *
 * **A scrolling body is a scroll container on *both* axes**, whatever the
 * `overflow-y-auto` shorthand suggests: CSS Overflow 3 computes a `visible`
 * `overflow-x` to `auto` when the other axis is not `visible`. A scroll
 * container clips ink overflow at its padding box — and `Input`'s
 * `focus-visible:ring-[3px]` is a box-shadow painted 3px *outside* the border
 * box, while `FieldGroup` and `Field` add no gutter of their own, so a
 * `w-full` field sits exactly on that edge. The dialog's fields would have
 * had their focus and `aria-invalid` rings shaved off on every side.
 *
 * The other two variants escape it for reasons that are theirs rather than
 * general: the drawer's body carries `px-4` for the gutters `SheetContent`
 * does not supply, and the `page` variant has no scroll container at all. The
 * shipped dialog had none either, which is why the adoption is what
 * introduces this.
 *
 * `-m-1` against the `p-1` so the fields land exactly where they do today and
 * the row's outer size is unchanged; the 4px of border box that escapes is
 * absorbed by `DialogContent`'s own `p-6`.
 */
const DIALOG_BODY = "p-1 -m-1";

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
        <DialogHeader className={DIALOG_HEADER}>
          <DialogTitle>{title}</DialogTitle>
          {description === undefined ? null : (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
      ) : null}
      {variant === "drawer" ? (
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description === undefined ? null : (
            <SheetDescription>{description}</SheetDescription>
          )}
        </SheetHeader>
      ) : null}
      {variant === "page" && description !== undefined ? (
        <p
          /*
           * `mb-6` because the page column is gapless: shipped, `Card`'s own
           * `flex flex-col gap-6` put that distance between `CardHeader` and
           * `CardContent`, and the column replaced both. Without it the lede
           * sits flush against the first field.
           */
          className="mb-6 text-sm text-muted-foreground"
          data-slot="surface-lede"
        >
          {description}
        </p>
      ) : null}

      <div
        className={cn(
          scrolls && "min-h-0 overflow-y-auto",
          variant === "dialog" && DIALOG_BODY,
          /*
           * With no footer the body is the drawer's last row, so it takes the
           * bottom gutter the footer would have carried — otherwise a detail
           * view or a long confirmation, both of which hand this container no
           * footer, sits flush against the drawer's edge. `SheetContent`
           * supplies no gutters at all.
           */
          variant === "drawer" &&
            (footer === undefined ? DRAWER_FOOTER : DRAWER_BODY),
        )}
        data-slot="surface-body"
      >
        {children}
      </div>

      {footer === undefined ? null : (
        <div
          className={cn(variant === "drawer" && DRAWER_FOOTER)}
          data-slot="surface-footer"
        >
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
          className={cn(DIALOG_BOUND, SIZES.dialog[size])}
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
   * The column carries `px-6` rather than the container nesting a
   * `CardContent`: the column *is* the app's `<form>` under the inversion, and
   * `Card` lays out its direct children (`flex flex-col gap-6 py-6`), so an
   * element between them would collapse that rhythm the same way wrapping
   * collapses the modal primitives'. `px-6` is what `CardContent` contributes,
   * applied where the row template already lives.
   */
  return (
    <Card
      className={cn("w-full", SIZES.page[size])}
      data-slot="record-surface"
      data-variant="page"
    >
      {inner}
    </Card>
  );
};
