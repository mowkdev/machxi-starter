import { useT } from "@repo/i18n";
import type { CSSProperties, ReactNode } from "react";

/**
 * The sign-in shell — Instrument's one screen whose redesign is structural
 * (ADR-0054 §7) — extracted at `D14.8` (ADR-0062 §1).
 *
 * §7 draws it as **a left-aligned 400px column on a 48px hairline-grid
 * ground**, with a caps brand line above a 28px title and a 14/20 lede, and it
 * named the admin's `widgets/auth-layout` as *app code* on the argument that
 * nothing else rendered it. Two apps later that argument has expired: the
 * customer's copy was byte-identical to the admin's, and a composition with
 * two consumers that must not drift is exactly what the kit is for.
 *
 * The tagline is read here rather than passed, because it is the same slot in
 * every app — `common:brand.authTagline`, the one place ADR-0054 §3's login
 * rung is used. Each app's catalogue answers for the sentence; both apps'
 * drift checks name the key in their `DYNAMIC` list, because a scan of `src/`
 * cannot see a `t()` call that lives in a package.
 */
const HAIRLINE_GROUND: CSSProperties = {
  backgroundImage:
    "linear-gradient(to right, var(--border) 1px, transparent 1px), " +
    "linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
  backgroundSize: "48px 48px",
};

export interface AuthLayoutProps {
  readonly children: ReactNode;
  readonly description: string | undefined;
  readonly title: string;
}

export const AuthLayout = ({
  children,
  description,
  title,
}: AuthLayoutProps) => {
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
          {/* The caps brand line of §7, 11/16 at 0.07em. */}
          <span className="text-[11px] leading-4 font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            {t("brand.authTagline")}
          </span>
          {/* §3's login rung, and the only place in an app that uses it. */}
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-tight">
            {title}
          </h1>
          {/* The 14/20 lede, absent on screens that have nothing to explain. */}
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
