import type { ErrorCode } from "@repo/contracts";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { isApiClientError } from "@/shared/api/api-error";
import { messageForError } from "@/shared/notifications/messages";

/**
 * Server-side failures, landed next to the field they belong to (ADR-0035).
 *
 * The division of labour with ADR-0034 is the thing to keep straight:
 * **field-level errors belong to the form**, **operation-level outcomes belong
 * to toasts**. A rule only the server can check — this email is already
 * taken — is still a field error, and showing it under the field is the whole
 * point of this function; a form that does so declares `meta: { errorToast:
 * false }` and stops the duplicate toast.
 *
 * The failure this is written against is a detail that matches nothing and
 * simply vanishes, leaving a form that rejected a submit and said why to
 * nobody. So every path ends somewhere visible: matched details go to their
 * field, and anything left over goes to the form-level `root.server`.
 *
 * ## Why a detail's own message is rendered verbatim (decided D3.9)
 *
 * `D3.7` flagged this and `D3.8` handed it on: a matched detail is shown in the
 * API's words, which looks like a second source of operator-facing copy beside
 * `ERROR_MESSAGES` and therefore a hole in the i18n seam. It is not, and the
 * reason is worth writing down rather than re-deriving:
 *
 * **A detail with a `path` is a zod issue from a `@repo/contracts` schema.**
 * `toErrorDetails` (`apps/api/src/core/errors/zod.ts`) is the only thing in the
 * API that ever sets one, and it copies `issue.message` unchanged from the
 * schema `validate()` parsed with — the *same* schema this form's `zodResolver`
 * runs on the way in (ADR-0011, ADR-0023). So the string this function renders
 * is the string the operator would have seen a moment earlier had the client
 * caught the rule first. Mapping it to a second sentence here would make one
 * rule read two ways depending on which side happened to notice it.
 *
 * That fixes both seams rather than leaving one open. **Codes are catalogued in
 * `ERROR_MESSAGES`; field rules are catalogued in the schema that defines
 * them** — and localising the latter is zod's own error map on the contracts
 * package, applied once for both sides, not a per-field map maintained here
 * that could drift from the rule it describes.
 *
 * The boundary that keeps this true is the `known` check below: a detail naming
 * something this form does not render never reaches an operator as raw copy —
 * it falls through to `messageForError`, which is the code catalogue. Details
 * without a path do the same, which is what happens to `RATE_LIMITED`'s
 * `retryAfter` and to anything else that is data rather than a sentence.
 */

/** Where the form-level message lives, for {@link AppFormError} to render. */
export const FORM_ERROR_PATH = "root.server";

export interface ServerErrorOptions {
  /** The form's own field names — anything else is not ours to set. */
  readonly fields: readonly string[];
  /**
   * Domain codes that mean "this field", for the failures the API reports
   * without a path.
   *
   * `STAFF_EMAIL_TAKEN` is a `409` with no `details` (the conflict is about the
   * request, not about a zod issue), but an operator's question is "what do I
   * change?" and the answer is the email box. Data, not a callback, so a
   * resource declares it beside its config.
   */
  readonly codeFields?: Readonly<Partial<Record<ErrorCode, string>>>;
}

/**
 * Applies a rejected mutation's error to a form.
 *
 * Returns whether anything landed on a *field*, so a caller can tell "the
 * operator has something to fix here" from "this failed for a reason the form
 * cannot express".
 */
export const applyServerErrors = <TValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TValues>,
  { fields, codeFields = {} }: ServerErrorOptions,
): boolean => {
  const formLevel = (message: string) => {
    setError(FORM_ERROR_PATH as Path<TValues>, { type: "server", message });
  };

  if (!isApiClientError(error)) {
    formLevel(messageForError(error));

    return false;
  }

  const known = new Set(fields);
  let landed = false;

  for (const detail of error.details ?? []) {
    /*
     * `path` is the dotted path the API sent (`"email"`, `"roles.0"`). The head
     * segment is what identifies the field; RHF understands the rest of the
     * path itself, so a per-member error on an array field lands on that
     * member rather than on the array.
     */
    const head = detail.path?.split(".")[0];

    if (detail.path === undefined || head === undefined || !known.has(head)) {
      continue;
    }

    setError(detail.path as Path<TValues>, {
      type: "server",
      message: detail.message,
    });
    landed = true;
  }

  if (landed) return true;

  const field = codeFields[error.code];

  if (field !== undefined && known.has(field)) {
    setError(field as Path<TValues>, {
      type: "server",
      message: messageForError(error),
    });

    return true;
  }

  // Nothing matched: a `403`, a conflict about the operation rather than a
  // field, a detail naming something this form does not render. It is still
  // shown — at the top of the form, where a submit failure is looked for.
  formLevel(messageForError(error));

  return false;
};
