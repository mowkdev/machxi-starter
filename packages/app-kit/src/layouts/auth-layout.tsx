import { useT } from "@repo/i18n";
import { Card } from "@repo/ui/components/card";
import type { ReactNode } from "react";

/**
 * The sign-in shell — Instrument's one screen whose redesign is structural
 * (ADR-0054 §7) — extracted at `D14.8` (ADR-0062 §1), and redrawn at `D31.2`
 * as **one centred card on a gradient ground** (ADR-0080 §3).
 *
 * The card holds everything the screen says: the caps brand line, the 28/34
 * title, the 14/20 lede, and the page's controls with its ways out below them.
 * It sits on both axes' centre at §7's 400px width, on §7's card rungs — 20px
 * padding and a 16px stack — over the primitive's 24/24, through `cn`, so the
 * generated `Card` stays byte-identical (ADR-0047).
 *
 * **The ground is a gradient between two tokens**, `--background` into
 * `--primary-tint`, painted over `bg-background` so the tint's alpha has a
 * surface to sit on. Both themes follow from the token sheet and no colour is
 * spelled here. The `D11.7` hairline grid, and the inline `style` it needed,
 * retired with the left-aligned column.
 *
 * The tagline is read here rather than passed, because it is the same slot in
 * every app — `common:brand.authTagline`. Each app's catalogue answers for the
 * sentence; both apps' drift checks name the key in their `DYNAMIC` list,
 * because a scan of `src/` cannot see a `t()` call that lives in a package.
 */
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
      className="flex min-h-svh w-full items-center justify-center bg-background bg-linear-to-br from-background to-primary-tint px-4 py-12"
      data-slot="auth-ground"
    >
      <Card className="w-full max-w-[400px] gap-4 p-5">
        <div className="flex flex-col gap-2" data-slot="auth-heading">
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
        {/*
         * A block, not a flex item list: the pages space their own ways out
         * (`mt-4` under the form), which a flex gap here would double.
         */}
        <div data-slot="auth-body">{children}</div>
      </Card>
    </div>
  );
};
