import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui";

/**
 * The first consumer of the ADR-0035 machinery.
 *
 * A placeholder page (ADR-0032): pages are thin composition, and this one has
 * nothing to compose yet. It exists so the route tree, the guard and the
 * dashboard shell are exercised end to end before any data layer exists.
 */
export const StaffPage = () => (
  <Card>
    <CardHeader>
      <CardTitle>Staff</CardTitle>
      <CardDescription>
        The first consumer of the ADR-0035 machinery.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">
        The staff grid and its CRUD flows arrive in D3.7.
      </p>
    </CardContent>
  </Card>
);
