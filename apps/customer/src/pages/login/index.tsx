import { Card } from "@/shared/ui";

/**
 * The sign-in screen, inside the shell of ADR-0054 §7.
 *
 * A page is thin composition: the shell supplies the brand line, the heading
 * and the lede, and what is left here is the card the reference draws around
 * the controls.
 *
 * **The card is empty at `D12.1`, and that is the step boundary rather than an
 * oversight**: the controls are `features/auth`'s `LoginForm`, which needs the
 * session machine and the `loginBody` contract — `D12.2`. What this step
 * proves is the frame the form lands in: the ground, the column, the heading
 * block, the route's own title and lede, and the card surface itself.
 *
 * The card carries §3's own 20px card padding directly, over the primitive's 24
 * — through `className`, so `packages/ui/src/components/` stays byte-identical
 * (ADR-0047). Its radius is already §7's 8: `Card` is the one generated
 * primitive whose `rounded-xl` agrees with the assignment.
 */
export const LoginPage = () => <Card className="p-5" />;
