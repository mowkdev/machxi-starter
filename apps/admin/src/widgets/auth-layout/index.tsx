import type { ReactNode } from "react";

/**
 * The `login-01` shell (ADR-0031, ADR-0032): a centred card on an empty page,
 * behind the pathless `_auth` route.
 *
 * A widget rather than a route file, because ADR-0032 keeps route files to
 * wiring — a path, a guard, a lazy page import — and this is composition. The
 * block is *adapted* here rather than vendored as a theme: the primitives it is
 * built from live in `@repo/ui`, and the arrangement of them is the app's.
 *
 * The `h1` is the shell's job for the same reason it is in the dashboard shell:
 * `CardTitle` renders a `div`, so a screen without this has no heading at all,
 * and ADR-0036's role-and-label discipline would have nothing to query.
 */
export const AuthLayout = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <div className="flex min-h-svh w-full items-center justify-center bg-muted p-6 md:p-10">
    <div className="w-full max-w-sm">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-sm text-muted-foreground">machxi admin</span>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  </div>
);
