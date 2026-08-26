import { useT } from "@/shared/i18n";
import { Card, CardContent, CardDescription, CardHeader } from "@/shared/ui";

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
    <Card>
      <CardHeader>
        {/*
         * No `CardTitle` here: the shell renders the route title as the
         * screen's single `<h1>` (ADR-0048 §2, `D8.4`). This is the page the
         * removal is easiest to miss on — it is not a grid, and no test could
         * see the leftover, because `CardTitle` is a `div`.
         */}
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </CardContent>
    </Card>
  );
};
