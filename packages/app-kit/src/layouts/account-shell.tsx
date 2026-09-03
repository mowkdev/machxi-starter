import { SettingsLayout } from "@repo/ui/compositions/settings-layout";
import type { ReactNode } from "react";

/**
 * The account area's shell (ADR-0053 §1), extracted at `D14.8` (ADR-0062 §1).
 *
 * **The shell moved and the section list did not**, which is this record's
 * second amendment and worth restating where the code is: `@tanstack/react-router`
 * types a `Link`'s `to` against the app's own registered route tree, so a
 * package that rendered the three links would either fail the consuming app's
 * `check-types` or need a cast turning a route id into a string — the exact
 * defect the router's typing exists to prevent. What both apps repeated and
 * what therefore lives here is the geometry: the `SettingsLayout` composition,
 * the active-link class, and the `<dt>`/`<dd>` summary pair.
 */
export interface AccountShellProps {
  /** The rendered section links — the app's, for the reason above. */
  readonly nav: ReactNode;
  readonly navLabel: string;
  readonly children: ReactNode;
}

/**
 * The class every account section link wears (ADR-0053 §2, ADR-0054's tints).
 *
 * A 36px row that goes muted → foreground on hover and, when active, takes the
 * primary tint with a 2px inset rule on its leading edge — the same active
 * treatment the sidebar uses, so the two navigations read as one system.
 */
export const ACCOUNT_SECTION_LINK =
  "flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[active=true]:bg-primary-tint data-[active=true]:text-foreground data-[active=true]:shadow-[inset_2px_0_0_var(--primary)] [&>svg]:size-4 [&>svg]:shrink-0";

export const AccountShell = ({
  nav,
  navLabel,
  children,
}: AccountShellProps) => (
  <SettingsLayout nav={nav} navLabel={navLabel}>
    {children}
  </SettingsLayout>
);

export interface AccountSummaryProps {
  readonly label: string;
  readonly children: ReactNode;
}

/** One labelled fact in the account summary's `<dl>`. */
export const AccountSummary = ({ label, children }: AccountSummaryProps) => (
  <div className="flex flex-col gap-1">
    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </dt>
    <dd className="text-sm">{children}</dd>
  </div>
);
