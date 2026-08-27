import { useFormContext } from "react-hook-form";

import { FieldError } from "@/shared/ui";

/**
 * The form-level failure, where {@link applyServerErrors} puts what no field
 * could claim.
 *
 * A form that renders its errors inline suppresses ADR-0034's toast, so this is
 * the only place an unmappable failure can still be seen. Rendering nothing
 * when there is nothing is what keeps it droppable at the top of every form.
 */
export const AppFormError = () => {
  const {
    formState: { errors },
  } = useFormContext();

  const message = errors.root?.server?.message;

  if (typeof message !== "string" || message === "") return null;

  return <FieldError>{message}</FieldError>;
};
