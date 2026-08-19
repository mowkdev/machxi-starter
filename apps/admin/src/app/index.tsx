import { useEffect, useState } from "react";

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Field, FieldDescription, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { Toaster } from "@repo/ui/components/sonner";

import { applyTheme, preferredTheme, type Theme } from "./theme";

/*
 * A placeholder, and deliberately nothing more: `D3.1` only has to prove that
 * both apps compile against `@repo/ui`, that its stylesheet reaches the browser
 * and that flipping the `dark` class repaints a rendered primitive from the
 * tokens. `D3.3` replaces this file with the FSD shell of ADR-0032.
 */
function App() {
  const [theme, setTheme] = useState<Theme>(preferredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            Admin
            <Badge variant="secondary">machxi</Badge>
          </CardTitle>
          <CardDescription>
            The design system is wired. The app is not — that is D3.3.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Field>
            <FieldLabel htmlFor="placeholder-email">Email</FieldLabel>
            <Input
              id="placeholder-email"
              placeholder="you@example.com"
              type="email"
            />
            <FieldDescription>
              A primitive, so the tokens have something to paint.
            </FieldDescription>
          </Field>
          <Button
            onClick={() => {
              setTheme(theme === "dark" ? "light" : "dark");
            }}
            variant="outline"
          >
            Switch to {theme === "dark" ? "light" : "dark"}
          </Button>
        </CardContent>
      </Card>
      <Toaster />
    </main>
  );
}

export default App;
