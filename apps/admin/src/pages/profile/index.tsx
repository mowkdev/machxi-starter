import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui";

/**
 * The account of whoever is signed in.
 *
 * A placeholder page (ADR-0032): pages are thin composition, and this one has
 * nothing to compose yet. It exists so the route tree, the guard and the
 * dashboard shell are exercised end to end before any data layer exists.
 */
export const ProfilePage = () => (
  <Card>
    <CardHeader>
      <CardTitle>Profile</CardTitle>
      <CardDescription>The account of whoever is signed in.</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">
        Name edits and change-password arrive in D3.9.
      </p>
    </CardContent>
  </Card>
);
