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
export const DashboardPage = () => (
  <Card>
    <CardHeader>
      <CardTitle>Dashboard</CardTitle>
      <CardDescription>The landing screen behind the guard.</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">
        Nothing to show until there is data to show it from.
      </p>
    </CardContent>
  </Card>
);
