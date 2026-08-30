import { LoginForm } from "@/features/auth";

import { Card } from "@/shared/ui";

/**
 * The login screen, inside the shell of ADR-0054 §7 (`D11.7`).
 *
 * A page is thin composition: the shell supplies the brand line, the heading
 * and the lede, the feature supplies the form and everything it does, and what
 * is left here is the card the reference draws around the controls.
 *
 * **The card holds the controls and nothing else now.** §7 lists its contents
 * as exactly that, so the subtitle that used to sit in a `CardHeader` moved to
 * the heading block above it, travelling on the route as
 * `staticData.description` — the channel `D11.3` opened when the grid pages'
 * cards retired for the same reason. With one child there is no header and no
 * content wrapper left to hang padding on, so the card carries §3's own 20px
 * card padding directly, over the primitive's 24 — through `cn`, so
 * `packages/ui/src/components/` stays byte-identical (ADR-0047). Its radius is
 * already §7's 8: `Card` is the one generated primitive whose `rounded-xl`
 * agrees with the assignment.
 */
export const LoginPage = () => (
  <Card className="p-5">
    <LoginForm />
  </Card>
);
