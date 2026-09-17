"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

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
 * construction — the marketing site D16 will add compiles this package through
 * `transpilePackages`, and a Next server component must be able to import any
 * export.
 *
 * **`action` arrived at `D13.7`, exactly as ADR-0048 §3 said it would.** That
 * record left the slot out of the v1 API and gave it the disposal
 * `headerStart` and `pageActions` got — "one prop wide when a screen names
 * it" — and D13's impersonation banner is the screen that names it: ADR-0057
 * §6 puts the exit control *in* the banner, because a warning that says a
 * session is not what it looks like has to carry the way out of it. This is
 * the prop, and it is the whole of the change: a `ReactNode` the caller
 * builds, rendered before the dismiss control. The composition stays dumb —
 * it does not know the node is a button, what pressing it ends, or that a
 * session exists.
 */

/**
 * Two variants, one per consumer the repository can name today: `info` for
 * `D8.7`'s dev-only pseudo-locale notice, `warning` for D13's impersonation
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
   * dismiss control on a banner whose whole job is to stay — D13's
   * impersonation warning being exactly that case. Opting in is a visible
   * line in a diff; opting out is a line someone has to remember to write.
   */
  readonly dismissible?: boolean;
  readonly onDismiss?: () => void;
  /**
   * The one control a banner may carry beside its dismiss (`D13.7`).
   *
   * A slot rather than a label-and-callback pair, for the reason the shell's
   * regions are slots: the caller owns the control's words, its variant and
   * its pending state, and a composition that took `actionLabel` would be
   * deciding two of the three. It renders between the message and the dismiss
   * control, which is the order the two have when both are present — the way
   * out first, and the way to stop reading about it second.
   */
  readonly action?: ReactNode;
  readonly className?: string;
}

export const Banner = ({
  message,
  variant = "info",
  dismissible = false,
  onDismiss,
  action,
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
      {action === undefined ? null : (
        <span className="shrink-0" data-slot="banner-action">
          {action}
        </span>
      )}
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
