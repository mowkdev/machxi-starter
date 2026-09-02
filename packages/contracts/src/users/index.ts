// Credential shapes are declared in `auth/` and re-exported here, so a client
// working against `/api/v1/user/*` finds them where it looks (ADR-0027).
export {
  changePasswordBody,
  setPasswordBody,
  type ChangePasswordBody,
  type SetPasswordBody,
} from "../auth/schemas.js";
export {
  LIST_USERS_FILTERABLE,
  LIST_USERS_SORTABLE,
  createUserBody,
  deleteProfileBody,
  listUsersQuery,
  updateProfileBody,
  updateUserBody,
  userIdParams,
  userRolesSchema,
  type CreateUserBody,
  type DeleteProfileBody,
  type ListUsersQuery,
  type UpdateProfileBody,
  type UpdateUserBody,
  type UserIdParams,
} from "./schemas.js";
export { type UserResource } from "./types.js";
