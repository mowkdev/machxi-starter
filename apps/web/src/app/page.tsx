import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";

export const metadata = {
  title: "Web | machxi",
};

/*
 * The minimal edit ADR-0031 asks for: the template's `CounterButton` and `Link`
 * are gone, and this page exists only to keep `web` compiling against the
 * design system. Building the app out is D4, not D3.
 */
export default function Web() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            Web
            <Badge variant="secondary">machxi</Badge>
          </CardTitle>
          <CardDescription>
            Placeholder until D4. The design system is shared with the admin
            panel; this app is not built out yet.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
