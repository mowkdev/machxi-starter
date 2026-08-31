import { useT } from "@/shared/i18n";
import { Card } from "@/shared/ui";

/**
 * The signed-in landing screen.
 *
 * A page is thin composition (ADR-0049), and what it composes here is one
 * sentence. **The `h1` left at `D12.5`**: the shell's page-header band owns the
 * heading and reads it off `staticData.title` (ADR-0054 §5) — the same
 * `home:title` this page used to render — so the element moved and the words
 * did not.
 *
 * **What it says is the decision, not the markup.** ADR-0055 §5 asks for a home
 * that states what v1 is rather than a dashboard pretending to be one: this app
 * ships self-service, no customer-ownable domain entity exists yet, and a
 * screen of empty stat tiles would be a promise the API cannot keep. So the
 * copy points at the thing there *is* to do — the account area — and says so
 * plainly. When the operator names the first domain entity, this is the screen
 * that grows a list; until then it is honest.
 *
 * A document page, so the card stays: ADR-0054 §5 retires the *page card* on
 * band layouts, and this is not one. It carries §3's 20px card padding over the
 * primitive's 24 through `className`, exactly as the sign-in card does, so
 * `packages/ui/src/components/` stays byte-identical (ADR-0047).
 */
export const HomePage = () => {
  const { t } = useT("home");

  return (
    <Card className="p-5">
      <p className="text-[14px] leading-5 text-muted-foreground">{t("body")}</p>
    </Card>
  );
};
