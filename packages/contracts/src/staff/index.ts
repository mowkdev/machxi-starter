// Credential shapes are declared in `auth/` and re-exported here, so a client
// working against `/api/v1/admin/*` finds them where it looks (ADR-0027).
export {
  changePasswordBody,
  setPasswordBody,
  type ChangePasswordBody,
  type SetPasswordBody,
} from "../auth/schemas.js";
export {
  createStaffBody,
  listStaffQuery,
  staffIdParams,
  staffRolesSchema,
  updateStaffBody,
  updateStaffProfileBody,
  type CreateStaffBody,
  type ListStaffQuery,
  type StaffIdParams,
  type UpdateStaffBody,
  type UpdateStaffProfileBody,
} from "./schemas.js";
export { type StaffResource } from "./types.js";
