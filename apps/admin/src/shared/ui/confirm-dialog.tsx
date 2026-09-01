import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";
import { Spinner } from "@repo/ui/components/spinner";

import { useT } from "@/shared/i18n";

/**
 * "Are you sure?" for an action with no form to host it.
 *
 * Not a re-export, so it lives beside the door rather than in it (see
 * `index.ts`): the behaviour it adds is the reason it exists. Two things
 * distinguish it from a bare `AlertDialog`:
 *
 * - **Confirming does not close it.** Radix's `Action` dismisses on click,
 *   which for a mutation means the dialog is gone before the request is
 *   answered — the operator sees no pending state, and a refusal arrives as a
 *   toast over a screen that already looks like it succeeded. The click is
 *   prevented and the caller closes on success instead.
 * - **It cannot be dismissed while pending**, for the reason `AppFormDialog`
 *   cannot: the request lands either way. A caller that needs to refuse a
 *   second press *without* taking the exits away passes `confirmDisabled`
 *   instead (`D13.8`).
 *
 * The refusal itself is ADR-0034's business — a confirm has no field for one to
 * land on, so these mutations keep their error toast and this component renders
 * no error of its own.
 */
export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel: string;
  /** Renders the confirm in the destructive style — deletion, revocation. */
  readonly destructive?: boolean;
  readonly isPending: boolean;
  /**
   * Refuses a second confirmation **without** locking the dialog shut
   * (`D13.8`).
   *
   * One prop wide because a screen named it — the shape ADR-0048 §3 uses for
   * `Banner`'s `action` slot. `isPending` deliberately does both jobs, and its
   * reason for the second is that the request lands either way, so there is
   * nothing dismissing could undo. The impersonation confirm has a state where
   * only the first job applies: the mint has answered and the browser is
   * navigating away, so pressing again must not mint a second time — but if
   * the navigation never happens, an operator locked out of Cancel, Escape and
   * the backdrop has only a reload left. Re-submission and dismissal are two
   * questions, and this is the prop that stops them being one.
   */
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  isPending,
  confirmDisabled = false,
  onConfirm,
}: ConfirmDialogProps) => {
  const { t } = useT("common");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!isPending) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            {t("actions.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={isPending || confirmDisabled}
            onClick={(event) => {
              // Keeps the dialog open so the pending state is visible and a
              // refusal arrives while the operator is still looking at what they
              // asked for.
              event.preventDefault();
              onConfirm();
            }}
          >
            {isPending ? <Spinner /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
