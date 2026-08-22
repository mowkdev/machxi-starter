import { Button } from "@repo/ui/components/button";

import { useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";

/**
 * A failed query, in the place its data would have been (ADR-0034, amended
 * D3.7).
 *
 * ADR-0034 makes queries silent — no toast — on the argument that "a failed
 * list has an error panel in the place the data would have been", and D3.7
 * turned that from an assumption into a requirement after a `403` rendered as
 * loading rows forever. This is the panel, extracted from `AppGrid` on its
 * second caller: `D3.9`'s profile page is a query with no table to put a
 * message inside, and two hand-written apologies would drift the moment one of
 * them gained a retry and the other did not.
 *
 * `messageForError` and nothing else, so the operator meets the ADR-0034
 * catalogue rather than the API's developer-facing `message` (ADR-0013).
 * `role="alert"` is what makes it announced rather than merely rendered.
 *
 * It renders the message alone when there is no `onRetry`: a failure with no
 * second attempt to offer is still worth showing, and a "Try again" that
 * retries nothing would be worse than no button.
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
