import { Card, CardContent, CardDescription, CardHeader } from "@/shared/ui";

/**
 * The login screen, inside the `login-01` shell (ADR-0032).
 *
 * A placeholder: `D3.4` replaces the body with `features/auth/login` — the
 * real form, its mutation, and the fields disabled while it is pending. What
 * this proves today is that the `_auth` layout renders and that the route is
 * reachable without a session.
 *
 * The heading belongs to the shell, so there is no `CardTitle` here repeating
 * it.
 */
export const LoginPage = () => (
  <Card>
    <CardHeader>
      <CardDescription>Staff accounts only.</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">
        The sign-in form arrives in D3.4, with the browser session it needs.
      </p>
    </CardContent>
  </Card>
);
