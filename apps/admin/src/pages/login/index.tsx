import { LoginForm } from "@/features/auth";

import { Card, CardContent, CardDescription, CardHeader } from "@/shared/ui";

/**
 * The login screen, inside the `login-01` shell (ADR-0032).
 *
 * A page is thin composition: the shell supplies the heading, the feature
 * supplies the form and everything it does.
 */
export const LoginPage = () => (
  <Card>
    <CardHeader>
      <CardDescription>Staff accounts only.</CardDescription>
    </CardHeader>
    <CardContent>
      <LoginForm />
    </CardContent>
  </Card>
);
