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

/** Whether `url`'s password is one {@link KNOWN_PUBLIC_DATABASE_PASSWORDS} lists. */
export const carriesCommittedPassword = (url: string): boolean =>
  KNOWN_PUBLIC_DATABASE_PASSWORDS.includes(databaseUrlPassword(url));
