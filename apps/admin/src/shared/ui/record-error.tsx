import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@repo/ui/components/card";
import { QueryError } from "./query-error";

/**
 * A record route whose loader rejected (ADR-0040).
 *
 * ADR-0040 asks for one thing precisely: an invalid or unknown id "renders the
 * error surface and offers the way back to the list — never a blank overlay
 * over a live grid". Both halves are here. The message comes from
 * {@link QueryError}, so a `404` reads out of the ADR-0034 catalogue like every
 * other failure rather than in a sentence written once for this case.
 *
 * The way back is `children` rather than a `to` prop, because `shared` holds no
 * domain knowledge (ADR-0032) and "the list this record belongs to" is exactly
 * that. The route supplies a typed `Link`; this supplies the frame around it.
 */
export const RecordError = ({
  error,
  children,
}: {
  readonly error: unknown;
  /** The way back — a typed `Link` from the route that owns the path. */
  readonly children: ReactNode;
}) => (
  <Card className="max-w-2xl">
    <CardHeader>
      {/*
       * A real `h2` rather than `CardTitle`, which is a styled `div`. An error
       * surface is the whole content of the screen when it renders, so its
       * title is a document heading — and ADR-0036 asks a suite to name things
       * the way a screen reader does, which it cannot do for a `div`.
       */}
      <h2 className="leading-none font-semibold">
        That record could not be opened
      </h2>
      <CardDescription>
        It may have been deleted, or the address may be wrong.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col items-start gap-4">
      <QueryError error={error} />
      {children}
    </CardContent>
  </Card>
);
