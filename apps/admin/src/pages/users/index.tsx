import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui";

/**
 * The second consumer, and the measure of the machinery.
 *
 * A placeholder page (ADR-0032): pages are thin composition, and this one has
 * nothing to compose yet. It exists so the route tree, the guard and the
 * dashboard shell are exercised end to end before any data layer exists.
 */
export const UsersPage = () => (
  <Card>
    <CardHeader>
      <CardTitle>Users</CardTitle>
      <CardDescription>
        The second consumer, and the measure of the machinery.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">
        The users grid and soft-delete flows arrive in D3.8.
      </p>
    </CardContent>
  </Card>
);
