# Postman

Produced in implementation step 10 (see `../implementation-plan.md`):

- `machxi-api.postman_collection.json` — folders: Health, Admin Auth, User Auth, Admin › Staff, Admin › Users, User › Profile. Login/refresh requests store `accessToken` / `refreshToken` into the environment; every request asserts status and envelope shape (ADR-0012, ADR-0021).
- `local.postman_environment.json` — `baseUrl=http://localhost:4000`; credential variables are left empty and filled from your `.env` (`SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`).

Run headless: `pnpm test:postman` (newman).
