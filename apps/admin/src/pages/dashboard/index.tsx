import { useT } from "@/shared/i18n";
import { Card, CardContent } from "@/shared/ui";

/**
 * The landing screen behind the guard.
 *
 * A placeholder page (ADR-0032): pages are thin composition, and this one has
 * nothing to compose yet. It exists so the route tree, the guard and the
 * dashboard shell are exercised end to end before any data layer exists.
 */
export const DashboardPage = () => {
  const { t } = useT("dashboard");

  return (
    /*
     * A document page, so the card stays: ADR-0054 §5 retires the *page card*
     * on band layouts, not every card in the app. What left at `D11.3` is the
     * header — the route title was already the shell's `<h1>` (`D8.4`), and
     * the description followed it into the page-header band through the
     * route's `staticData`, which left a `CardHeader` holding nothing.
     */
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </CardContent>
    </Card>
  );
};
