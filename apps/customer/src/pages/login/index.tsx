import { LoginForm } from "@/features/auth";

import { Card } from "@/shared/ui";

/**
 * The sign-in screen, inside the shell of ADR-0054 §7.
 *
 * A page is thin composition: the shell supplies the brand line, the heading
 * and the lede, and what is left here is the card the reference draws around
 * the controls.
 *
 * The card holds the controls and nothing else: ADR-0054 §7 lists its contents
 * as exactly that, and the brand line, the heading and the lede sit above it in
 * the shell, travelling on the route as `staticData`.
 *
 * The card carries §3's own 20px card padding directly, over the primitive's 24
 * — through `className`, so `packages/ui/src/components/` stays byte-identical
 * (ADR-0047). Its radius is already §7's 8: `Card` is the one generated
 * primitive whose `rounded-xl` agrees with the assignment.
 */
export const LoginPage = () => (
  <Card className="p-5">
    <LoginForm />
  </Card>
);
