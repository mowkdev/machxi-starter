export {
  formatConfigIssues,
  loadConfig,
  toAppConfig,
  type AppConfig,
} from "./config.js";
export {
  isProductionTrustProxy,
  toTrustProxy,
  type TrustProxy,
} from "./trust-proxy.js";
export { MAX_DURATION_SECONDS, parseDurationSeconds } from "./duration.js";
export {
  KNOWN_PUBLIC_DATABASE_PASSWORDS,
  databaseUrlPassword,
} from "./database-password.js";
export {
  KNOWN_PUBLIC_SECRETS,
  KNOWN_PUBLIC_SEED_PASSWORDS,
  PLACEHOLDER_SEED_SUPER_ADMIN_PASSWORD,
  TEST_SEED_SUPER_ADMIN_PASSWORD,
  LOCAL_ADMIN_APP_URL,
  LOCAL_API_PUBLIC_URL,
  LOCAL_CUSTOMER_APP_URL,
  LOG_LEVELS,
  NODE_ENVS,
  PLACEHOLDER_JWT_ACCESS_SECRET,
  PROD_COMPOSE_JWT_ACCESS_SECRET,
  TEST_JWT_ACCESS_SECRET,
  envSchema,
  type Env,
} from "./schema.js";
