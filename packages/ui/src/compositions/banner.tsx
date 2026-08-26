"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";
import { useUiStrings } from "@repo/ui/ui-strings";

/**
 * The notice the shell's `banner` slot is filled with (ADR-0048 §3).
 *
 * Hand-written rather than built on shadcn's `alert`, which this package does
 * not carry: generating a primitive only to be a substrate would buy an
 * upstream-diff obligation for a component used as raw material (ADR-0047
 * §What-code). It lives in `compositions/` and is therefore ordinary owned
 * code — formatted, reviewed, edited rather than regenerated.
 *
 * **It is dumb by construction, and that is the point of the boundary.** No
 * `@repo/contracts` import, no principal, no session store, no dismissed state
 * of its own: `dismissible` renders the control and `onDismiss` hands the
 * gesture back. Who may dismiss what, and whether it stays dismissed across a
 * navigation, is a session question — a composition that answered it would be
 * a composition that had learned *why* a banner is showing. The boundary is
 * checkable rather than asserted: `@repo/contracts` is not among this
 * package's dependencies, so reaching for it is a red `check-types`.
 *
 * `"use client"` because it reads `UiStrings`, which is a context read, and
 * ADR-0047 rules that a composition with micro-copy is a client component by
 * construction — `apps/web` compiles this package through `transpilePackages`
 * and a Next server component must be able to import any export.
 *
 * **There is no `action` slot.** Neither consumer this repository can name has
 * one, so it takes the disposal `headerStart` and `pageActions` got: one prop
 * wide when a screen names it.
 */

/**
 * Two variants, one per consumer the repository can name today: `info` for
 * `D8.7`'s dev-only pseudo-locale notice, `warning` for D12's impersonation
 * banner. A third arrives with the notice that needs it — the slot-honesty
 * rule is unreviewable against an open-ended set.
 */
const bannerVariants = cva(
  "flex items-center gap-3 rounded-md border px-4 py-2 text-sm",
  {
    variants: {
      variant: {
        info: "border-border bg-muted text-muted-foreground",
        warning:
          "border-destructive/50 bg-destructive/10 text-destructive dark:border-destructive",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
);

/**
 * Derived from the map rather than spelled again beside it, the way the
 * primitives derive theirs: ADR-0048 §3 expects a third variant with the
 * notice that needs one, and a hand-written union would let that variant
 * compile and stay unreachable through the prop.
 */
export type BannerVariant = NonNullable<
  VariantProps<typeof bannerVariants>["variant"]
>;

export interface BannerProps {
  /**
   * The sentence a person reads. A plain string rather than a slot: the shell
   * fills the region, the app decides the words, and anything richer than a
   * sentence is a sign the caller wanted the slot rather than this component.
   */
  readonly message: string;
  readonly variant?: BannerVariant;
  /**
   * Off by default, deliberately. The fail-safe direction is the one where
   * forgetting the prop leaves the notice on screen rather than putting a
   * dismiss control on a banner whose whole job is to stay — D12's
   * impersonation warning being exactly that case. Opting in is a visible
   * line in a diff; opting out is a line someone has to remember to write.
   */
  readonly dismissible?: boolean;
  readonly onDismiss?: () => void;
  readonly className?: string;
}

export const Banner = ({
  message,
  variant = "info",
  dismissible = false,
  onDismiss,
  className,
}: BannerProps) => {
  const { dismiss } = useUiStrings();

  return (
    <div
      className={cn(bannerVariants({ variant }), className)}
      data-slot="banner"
      data-variant={variant}
      /*
       * A polite live region for both variants, not `alert` for `warning`.
       * Both named consumers are persistent chrome present at mount, where an
       * assertive region announces nothing anyway — a live region reports
       * *changes* — and `role="alert"` is the wrong container for the
       * focusable dismiss control `dismissible` puts inside it. Severity is a
       * visual fact and `data-variant`; if a consumer ever needs to interrupt,
       * that is a prop with a name and a reason, added when it exists
       * (ADR-0048 §3, amended `D8.2`).
       */
      role="status"
    >
      <span className="min-w-0 flex-1">{message}</span>
      {dismissible ? (
        <Button
          aria-label={dismiss}
          className="-mr-2 shrink-0"
          onClick={onDismiss}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  );
};
