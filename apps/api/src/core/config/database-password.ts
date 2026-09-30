/**
 * Database passwords this repository commits (ADR-0083 §5, ADR-0078 §2's rule
 * reaching `DATABASE_URL`): the local roles' in `.env.example`, `.env.test`
 * and `docker/local/postgres/init`, the local superuser's `POSTGRES_PASSWORD`,
 * and `docker/prod/.env.example`'s placeholder. A production `DATABASE_URL`
 * carrying one is refused at startup, like a committed signing key;
 * `committed-secrets.test.ts` reads the committed files and fails when one is
 * missing from this list.
 */
export const KNOWN_PUBLIC_DATABASE_PASSWORDS: readonly string[] = [
  "machxi",
  "machxi_app",
  "machxi_owner",
  "password",
];

/** The password a database URL carries, decoded — empty when it has none. */
export const databaseUrlPassword = (url: string): string => {
  const password = URL.parse(url)?.password ?? "";

  try {
    return decodeURIComponent(password);
  } catch {
    return password;
  }
};

/**
 * Whether production refuses `url`: its password is one
 * {@link KNOWN_PUBLIC_DATABASE_PASSWORDS} lists, **or it carries none**.
 *
 * The second half is ADR-0083 §5 as amended at `D35.4`. postgres.js takes the
 * password from the URL and, when the URL has none, from `PGPASSWORD`
 * (`parseOptions`: `url.password || env.PGPASSWORD`), which this schema does
 * not declare and so cannot check. A password-less URL would therefore let a
 * committed password through the variable beside it; refusing the URL keeps the
 * password where the check can see it, with no second variable to declare.
 * (A multi-host URL never reaches this: the schema's `z.url()` refuses it.)
 */
export const isRefusedProductionDatabaseUrl = (url: string): boolean => {
  const password = databaseUrlPassword(url);

  return password === "" || KNOWN_PUBLIC_DATABASE_PASSWORDS.includes(password);
};
