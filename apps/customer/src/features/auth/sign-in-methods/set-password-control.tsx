import { useRequestPasswordSetLink } from "@/entities/profile";
import { useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import { Button, FieldError } from "@/shared/ui";

export interface SetPasswordControlProps {
  /** The account's own address — where the link goes, and what the sentence names. */
  readonly email: string;
}

/**
 * "Set a password" (ADR-0072 §3, §4) — for an account whose only way in is
 * Google.
 *
 * **It posts `set-link` and says where to look**: the API mails the account's
 * own `/reset-password` link to its own address, and the password is chosen
 * there — never in a field on this screen, which is what keeps a session in
 * the wrong hands from minting itself a permanent credential. On `202` the
 * control gives way to the check-your-mail sentence, `role="status"` for the
 * forgot screen's reason: nothing went wrong, and a screen reader should hear
 * it when it gets to it.
 *
 * A refusal — the set-link budget's `429`, or the `409` a stale screen meets
 * when the account has a password after all — is the catalogue's sentence
 * beside the control, which stays pressable.
 */
export const SetPasswordControl = ({ email }: SetPasswordControlProps) => {
  const { t } = useT("profile");
  const setLink = useRequestPasswordSetLink();
  const messageForError = useMessageForError();

  if (setLink.isSuccess) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t("methods.password.sent", { email })}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        aria-busy={setLink.isPending}
        disabled={setLink.isPending}
        onClick={() => {
          setLink.mutate();
        }}
        type="button"
        variant="outline"
      >
        {t("methods.password.set")}
      </Button>
      {setLink.isError ? (
        <FieldError role="alert">{messageForError(setLink.error)}</FieldError>
      ) : null}
    </div>
  );
};

/**
 * What stands in for the three current-password ceremonies — change the
 * password, change the address, delete the account — while the account has no
 * password (ADR-0072 §3, amended between `D19.2` and `D19.3`).
 *
 * The API is unchanged: each of the three asks the current password, a null
 * hash never verifies, and the answer would be the `403` it has always been.
 * So instead of opening a dialog that asks for something that does not exist,
 * the screen says so — one sentence — and offers the control that fixes it.
 */
export const SetPasswordFirst = ({ email }: SetPasswordControlProps) => {
  const { t } = useT("profile");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {t("methods.passwordFirst")}
      </p>
      <SetPasswordControl email={email} />
    </div>
  );
};
