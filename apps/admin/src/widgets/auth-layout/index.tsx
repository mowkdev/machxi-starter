import type { CSSProperties, ReactNode } from "react";

import { useT } from "@/shared/i18n";

/**
 * The login shell — Instrument's one screen whose redesign is structural
 * (ADR-0054 §7, `D11.7`).
 *
 * It replaces the `login-01` block of ADR-0031/0032: a centred `max-w-sm` card
 * on a `bg-muted` page, with its heading centred above it. What ships now is
 * the reference's composition — **a left-aligned 400px column on a 48px
 * hairline-grid ground** — and it is app code rather than a `@repo/ui`
 * composition for the reason §7 gives by naming this file: nothing else
 * renders it, and a composition with one consumer is a package's worth of
 * indirection around an app's screen.
 *
 * It stays a widget rather than a route file, unchanged from `D3.1`: ADR-0032
 * keeps route files to wiring — a path, a guard, a lazy page import — and this
 * is composition. The `h1` is still the shell's job, for the reason it is in
 * the dashboard shell: `CardTitle` renders a `div`, so a screen without this
 * has no heading at all and ADR-0036's role-and-label discipline would have
 * nothing to query.
 */

/**
 * The ground (ADR-0054 §7): a 48px grid of hairlines, the same in both themes.
 *
 * An inline background rather than a utility, and the choice is deliberate on
 * both counts. It is a **paint**, not a layout value, so it has nothing to say
 * to Tailwind's scale; and its colour is `--border` — the token the rest of
 * the chrome is ruled with — so §2's "a colour in a component is the defect"
 * is honoured by *reading* the token here rather than by inventing a literal.
 * Written as a module constant so the object identity is stable across
 * renders and so the two numbers sit beside the record's own sentence.
 *
 * 48px is the module the column is then placed on: `md:px-24` is two of them,
 * which is what puts the column's left edge on a grid line instead of near
 * one.
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
   * The lede under the heading, from the route (`D11.3`'s channel).
   *
   * It used to be a `CardDescription` inside the login page. §7 lists the
   * card's contents as the controls, so the sentence *about* the screen moves
   * out of it and under the heading — the same move `D11.3` made when the
   * grid pages' cards retired, on the same channel, and it is why this shell
   * needs no i18n key of its own for it.
   *
   * `string | undefined` rather than optional: `exactOptionalPropertyTypes`
   * is on, and the caller hands through whatever `useRouteDescription`
   * returned.
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
           * The brand line, on §3's caps rung — the record's one label size,
           * the same one the grid's column heads and group labels take. It is
           * a label above a title, not a sentence.
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
           * shell's page-header band uses — the distinction ADR-0054 §7's
           * `D11.5` amendment drew between the two, applied here for the same
           * reason: this is the first paragraph of a screen, not the second
           * half of a title bar. No element at all when a route declares
           * nothing, which is the band's rule too.
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
