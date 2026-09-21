import type { ComponentProps } from "react";

import { Spinner as SpinnerPrimitive } from "@repo/ui/components/spinner";

import { useT } from "@/shared/i18n";

/**
 * The design system's spinner, with a name a screen reader can say in the
 * operator's language (`D28.8`, ADR-0046 §12; the review's `FE-10`).
 *
 * The primitive announces itself as `role="status"` with a hard-coded
 * `aria-label="Loading"`, so every locale heard English — and the pseudo-locale
 * walk could not see it, because a spinner is on screen only while something is
 * in flight. The primitive stays byte-identical to the CLI's output
 * (ADR-0047's generated-versus-written rule): the name is supplied here, from
 * the catalogue, and the door exports this in the primitive's place.
 *
 * A caller's own `aria-label` still wins, because the primitive spreads its
 * props after its defaults.
 *
 * It imports the primitive directly for `confirm-dialog.tsx`'s reason: this
 * file is inside the door, and going through `./index` would make the slice
 * import its own barrel.
 */
export const Spinner = (props: ComponentProps<typeof SpinnerPrimitive>) => {
  const { t } = useT("common");

  return <SpinnerPrimitive aria-label={t("loading.label")} {...props} />;
};
