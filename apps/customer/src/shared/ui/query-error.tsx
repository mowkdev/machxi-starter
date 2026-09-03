import { Button } from "@repo/ui/components/button";

import { useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";

/**
 * A failed query, in the place its data would have been (`D12.6`; ADR-0034 as
 * carried by ADR-0043).
 *
 * ADR-0034 makes queries silent — no toast — on the argument that a failed read
 * "has an error panel in the place the data would have been", and the panel is
 * the half of that sentence a component has to build. This app's first query is
 * the account's own profile, which has no table to put a message inside, so the
 * panel takes the place of the summary itself.
 *
 * `messageForError` and nothing else, so the customer meets the ADR-0034
 * catalogue rather than the API's developer-facing `message` (ADR-0013).
 * `role="alert"` is what makes it announced rather than merely rendered.
 *
 * It renders the message alone when there is no `onRetry`: a failure with no
 * second attempt to offer is still worth showing, and a "Try again" that
 * retries nothing would be worse than no button.
 *
 * **It imports `@repo/ui/components/button` directly**, and that is the door
 * rule rather than a hole in it: this file *is* inside `shared/ui`, which is the
 * door, and going through `./index` would make the slice import its own barrel.
 * `@repo/app-kit`'s loader and router defaults do the same.
 */
export const QueryError = ({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry?: (() => void) | undefined;
}) => {
  const { t } = useT("common");
  const messageForError = useMessageForError();

  return (
    <>
      <p className="text-sm text-destructive" role="alert">
        {messageForError(error)}
      </p>
      {onRetry === undefined ? null : (
        <Button className="mt-3" onClick={onRetry} size="sm" variant="outline">
          {t("actions.retry")}
        </Button>
      )}
    </>
  );
};
