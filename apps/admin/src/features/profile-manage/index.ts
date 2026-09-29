/**
 * The operator's own profile — a door onto `@repo/account` since `D22.2`
 * (ADR-0077 §2–§3; ADR-0027 §Staff self-service).
 *
 * The two forms are the package's. What this slice binds is what is this
 * app's: the staff half of the contracts pair, the profile entity on the admin
 * segment, the three sentences an operator is told in an operator's words,
 * and the one thing only this segment has — the acting operator is also a row
 * in `/admin/staff`, so both writes invalidate it.
 */
import {
  createChangePasswordDialog,
  createProfileDetailsForm,
} from "@repo/account";
import {
  updateStaffProfileBody,
  type StaffResource,
  type UpdateStaffProfileBody,
} from "@repo/contracts";

import {
  ProfileFormInput,
  profileFields,
  useChangePassword,
  useUpdateProfile,
} from "@/entities/profile";
import { useMessageForError } from "@/shared/notifications/messages";

import { useInvalidateOwnStaffRow } from "./use-invalidate-own-staff-row";

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
    // The password write stamps `updatedAt` on this operator's own staff row.
    useAfterChange: useInvalidateOwnStaffRow,
  });

export const ProfileDetailsForm = createProfileDetailsForm<
  StaffResource,
  UpdateStaffProfileBody
>({
  schema: updateStaffProfileBody,
  fields: profileFields,
  FormInput: ProfileFormInput,
  toFormValues: (profile) => ({
    firstName: profile.firstName,
    lastName: profile.lastName,
  }),
  useUpdateProfile,
  useMessageForError,
  // The names on this operator's own `/admin/staff` row are the ones that
  // just changed — see the hook for why the invalidation is here and not in
  // the entity.
  useAfterSave: useInvalidateOwnStaffRow,
});
