import type { CSSProperties, ReactNode } from "react";

import { useT } from "@/shared/i18n";

/**
 * The customer app's sign-in shell — Instrument's login composition
 * (ADR-0054 §7) on its second app (`D12.1`).
 *
 * §7 draws it as **a left-aligned 400px column on a 48px hairline-grid
 * ground**, with a caps brand line above a 28px title and a 14/20 lede, and it
 * names the admin's `widgets/auth-layout` as *app code* rather than a
 * `@repo/ui` composition — the argument being that a composition with one
 * consumer is a package's worth of indirection around a screen.
 *
 * **That argument now has a second consumer, and the plan's standing rule says
 * a package diff is named before it is made — so this is a finding, recorded in
 * the plan rather than acted on here.** The two shells are the same geometry
 * and are not the same screen: this one heads a customer's own account, the
 * admin's heads a staff console, and what differs today is exactly the copy the
 * shells do not hold. The finding is written down so the third consumer — or a
 * geometry change that has to land twice — is the thing that moves it into
 * `@repo/ui/compositions`, rather than a guess made now.
 *
 * It is a widget rather than a route file for the reason the admin's is:
 * ADR-0049 keeps route files to wiring, and this is composition. The `h1` is
 * the shell's job — `CardTitle` renders a `div`, so a screen without this has
 * no heading at all and ADR-0036's role-and-label discipline would have nothing
 * to query.
 */

/**
 * The ground (ADR-0054 §7): a 48px grid of hairlines, the same in both themes.
 *
 * An inline background rather than a utility, and the choice is deliberate on
 * both counts. It is a **paint**, not a layout value, so it has nothing to say
 * to Tailwind's scale; and its colour is `--border` — the token the rest of the
 * chrome is ruled with — so §2's "a colour in a component is the defect" is
 * honoured by *reading* the token here rather than by inventing a literal.
 *
 * 48px is the module the column is then placed on: `md:px-24` is two of them,
 * which is what puts the column's left edge on a grid line instead of near one.
 */
const HAIRLINE_GROUND: CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, var(--border) 1px, transparent 1px), " +
    "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
  backgroundSize: "48px 48px",
};

export const AuthLayout = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  /**
   * The lede under the heading, from the route (ADR-0054 §7).
   *
   * `string | undefined` rather than optional: `exactOptionalPropertyTypes` is
   * on, and the caller hands through whatever `useRouteDescription` returned.
   * No element at all when a route declares nothing.
   */
  description: string | undefined;
  title: string;
}) => {
  const { t } = useT("common");

  return (
    <div
      className="flex min-h-svh w-full items-center bg-background px-6 md:px-24"
      data-slot="auth-ground"
      style={HAIRLINE_GROUND}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-6 py-12"
        data-slot="auth-column"
      >
        <div className="flex flex-col gap-2">
          {/*
           * The brand line, on §3's caps rung — the record's one label size. It
           * is a label above a title, not a sentence.
           */}
          <span className="text-[11px] leading-4 font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            {t("brand.authTagline")}
          </span>
          {/* §3's login rung, and the only place in the app that uses it. */}
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-tight">
            {title}
          </h1>
          {/*
           * A lede, at §3's 14/20 body rung rather than the 13px meta line the
           * shell's page-header band uses: this is the first paragraph of a
           * screen, not the second half of a title bar.
           */}
          {description === undefined ? null : (
            <p
              className="text-[14px] leading-5 text-muted-foreground"
              data-slot="auth-description"
            >
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
};
