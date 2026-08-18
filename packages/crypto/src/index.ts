/**
 * `@repo/crypto` — password hashing, token hashing and random tokens (ADR-0018).
 *
 * Shared by the API's auth service and the database seeders (ADR-0008) so both
 * use one implementation. Depends on nothing internal (ADR-0002). Node-only:
 * `argon2` is a native CJS module, so this package must never enter a browser
 * bundle and must be marked external by the API's bundler.
 */
export {
  createArgon2Hasher,
  defaultArgon2Params,
  minArgon2Params,
  type Argon2Params,
  type PasswordHasher,
} from "./password.js";
export { sha256Base64url } from "./hash.js";
export { maxTokenBytes, minTokenBytes, randomToken } from "./tokens.js";
