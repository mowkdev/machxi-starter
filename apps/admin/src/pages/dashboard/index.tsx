import { useT } from "@/shared/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui";

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
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      </CardContent>
    </Card>
  );
};
