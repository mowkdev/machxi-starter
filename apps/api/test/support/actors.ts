import type {
  CreateStaffBody,
  CreateUserBody,
  StaffResource,
  UserResource,
} from "@repo/contracts";
import type { Express } from "express";
import supertest from "supertest";

/**
 * The accounts a step-9 file acts *as*, and the accounts it acts *on*
 * (ADR-0021).
 *
 * Everything here is setup, not assertion: each endpoint it drives is also
 * exercised directly, with its status and envelope checked, in the file that
 * owns it. Sharing the setup is what keeps a suite honest about which account
 * it is signed in as — the seeded population has no plain `admin`, so an
 * `admin`-but-not-`super_admin` caller has to be built, and building it by
 * hand in four files is four chances to build a subtly different one.
 */

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/** The auth base path of each population (ADR-0015). */
export const AUTH_BASE = {
  staff: "/api/v1/admin/auth",
  user: "/api/v1/user/auth",
} as const;

export type PopulationName = keyof typeof AUTH_BASE;

/**
 * The initial password of every account these helpers create.
 *
 * Distinct from `FIXTURE_PASSWORD` so that a test asserting "the account can
 * log in with the password the admin chose" cannot pass because the seeder
 * happened to use the same one.
 */
export const NEW_ACCOUNT_PASSWORD = "CreatedByAdmin!2026";

export const bearer = (token: string): string => `Bearer ${token}`;

/** Signs in and returns the pair, failing loudly if the credentials do not. */
export const login = async (
  app: Express,
  population: PopulationName,
  credentials: Credentials,
): Promise<Tokens> => {
  const response = await supertest(app)
    .post(`${AUTH_BASE[population]}/login`)
    .send(credentials)
    .expect(200);

  return {
    accessToken: response.body.data.accessToken as string,
    refreshToken: response.body.data.refreshToken as string,
  };
};

/** `POST /api/v1/admin/staff` as an `admin`, returning the created resource. */
export const createStaffMember = async (
  app: Express,
  adminToken: string,
  body: Partial<CreateStaffBody> & Pick<CreateStaffBody, "email" | "roles">,
): Promise<StaffResource> => {
  const response = await supertest(app)
    .post("/api/v1/admin/staff")
    .set("Authorization", bearer(adminToken))
    .send({
      password: NEW_ACCOUNT_PASSWORD,
      firstName: "Created",
      lastName: "Staff",
      ...body,
    })
    .expect(201);

  return response.body.data as StaffResource;
};

/** `POST /api/v1/admin/users` as an `admin`, returning the created resource. */
export const createUserAccount = async (
  app: Express,
  adminToken: string,
  body: Partial<CreateUserBody> & Pick<CreateUserBody, "email">,
): Promise<UserResource> => {
  const response = await supertest(app)
    .post("/api/v1/admin/users")
    .set("Authorization", bearer(adminToken))
    .send({ password: NEW_ACCOUNT_PASSWORD, ...body })
    .expect(201);

  return response.body.data as UserResource;
};

/**
 * Encodes a list query (ADR-0014) into a query string.
 *
 * Written out rather than handed to supertest's `.query()` because the whole
 * filter syntax lives in square brackets: `filter[status][in]` has to reach
 * Express percent-encoded and come back out of `qs` as a two-level object, and
 * a helper that guesses at that encoding would be testing itself.
 */
export const listQueryString = (
  params: Readonly<Record<string, string | number>>,
): string =>
  Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
