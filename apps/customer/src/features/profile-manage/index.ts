/**
 * A customer's own profile — a door onto `@repo/account` for the two forms
 * both segments have, since `D22.2` (ADR-0077 §2–§3; ADR-0027 §Self-service,
 * ADR-0055 §4).
 *
 * What this slice binds is what is this app's: the user half of the contracts
 * pair, the profile entity on the user segment, and the three sentences a
 * customer is told in a customer's words. What only this segment has stays
 * here as code: changing the address, and deleting the account.
 */
import {
  createChangePasswordDialog,
  createProfileDetailsForm,
} from "@repo/account";
import {
  updateProfileBody,
  type UpdateProfileBody,
  type UserResource,
} from "@repo/contracts";

import {
  ProfileFormInput,
  profileFields,
  useChangePassword,
  useUpdateProfile,
} from "@/entities/profile";
import { useMessageForError } from "@/shared/notifications/messages";

export { ChangeEmailDialog, changeEmailFields } from "./change-email-dialog";
export {
  DeleteAccountDialog,
  deleteAccountFields,
} from "./delete-account-dialog";

export const { ChangePasswordDialog, changePasswordFields } =
  createChangePasswordDialog({
    copy: {
      dialogDescription: "profile:password.dialog.description",
      currentPasswordDescription:
        "profile:password.fields.currentPassword.description",
      newPasswordDescription: "profile:password.fields.newPassword.description",
    },
    useChangePassword,
    useMessageForError,
  });

export const ProfileDetailsForm = createProfileDetailsForm<
  UserResource,
  UpdateProfileBody
>({
  schema: updateProfileBody,
  fields: profileFields,
  FormInput: ProfileFormInput,
  /*
   * `?? ""` because a customer's names are nullable (ADR-0017) and a
   * controlled text input handed `null` is an uncontrolled one React warns
   * about. An untouched empty box is never dirty, so the request never
   * carries the `""` that stands for a `null` name.
   */
  toFormValues: (profile) => ({
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
  }),
  useUpdateProfile,
  useMessageForError,
});
