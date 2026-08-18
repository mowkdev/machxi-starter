// Credential shapes are declared in `auth/` and re-exported here, so a client
// working against `/api/v1/user/*` finds them where it looks (ADR-0027).
export {
  changePasswordBody,
  setPasswordBody,
  type ChangePasswordBody,
  type SetPasswordBody,
} from "../auth/schemas.js";
export {
  createUserBody,
  listUsersQuery,
  updateProfileBody,
  updateUserBody,
  userIdParams,
  userRolesSchema,
  type CreateUserBody,
  type ListUsersQuery,
  type UpdateProfileBody,
  type UpdateUserBody,
  type UserIdParams,
} from "./schemas.js";
export { type UserResource } from "./types.js";
