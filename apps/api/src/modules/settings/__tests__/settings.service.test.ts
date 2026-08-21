import { MAX_SETTINGS_GRIDS, type GridPreferencesV1 } from "@repo/contracts";
import { createLogger } from "@repo/logger";
import { describe, expect, it } from "vitest";

import {
  createRequestContext,
  type Principal,
  type RequestContext,
} from "../../../core/context/index.js";
import { isAppError } from "../../../core/errors/index.js";
import type {
  SettingsRecord,
  SettingsRepository,
  SettingsWrite,
} from "../settings.repository.js";
import {
  applyPatch,
  createSettingsService,
  mergeGrids,
} from "../settings.service.js";

/**
 * The settings service against fake repositories (ADR-0021 §Unit).
 *
 * No database and no Express. What is under test is what neither a guard nor a
 * schema can see: the per-key merge rule, the bound that only applies to the
 * *merged* row, and the one line where a population becomes a table — which is
 * the whole of this module's authorization story (ADR-0045 §Security).
 */

const STAFF_ID = "11111111-1111-7111-8111-111111111111";
const USER_ID = "22222222-2222-7222-8222-222222222222";

const arrangement = (width: number): GridPreferencesV1 => ({
  v: 1,
  sizing: { email: width },
  order: ["email", "status"],
  hidden: [],
});

const contextFor = (principal: Principal): RequestContext => {
  const ctx = createRequestContext({
    requestId: "req-settings",
    logger: createLogger({ level: "silent", name: "test" }),
  });

  ctx.principal = principal;

  return ctx;
};

const staffContext = () =>
  contextFor({
    kind: "staff",
    id: STAFF_ID,
    roles: ["editor"],
    sessionId: "s-1",
  });

const userContext = () =>
  contextFor({
    kind: "user",
    id: USER_ID,
    roles: ["customer"],
    sessionId: "s-2",
  });

/* ── fakes ────────────────────────────────────────────────────────────────── */

/**
 * One in-memory table. Both halves are built from this, so a test can assert
 * that a write landed in one and not the other — which is the property the
 * two-table decision exists to give.
 */
const createFakeTable = () => {
  const rows = new Map<string, SettingsRecord>();
  const locked: string[] = [];

  return {
    rows,
    locked,
    repository: {
      findByPrincipal: (principalId: string) =>
        Promise.resolve(rows.get(principalId)),
      lockForUpdate: (principalId: string) => {
        locked.push(principalId);

        const existing = rows.get(principalId);

        if (existing !== undefined) return Promise.resolve(existing);

        // The real one inserts the defaults row before locking it, so a
        // first-ever PATCH merges against a row rather than against nothing.
        const created: SettingsRecord = {
          theme: "system",
          locale: "en",
          grids: {},
        };

        rows.set(principalId, created);

        return Promise.resolve(created);
      },
      save: (principalId: string, next: SettingsWrite) => {
        const stored: SettingsRecord = {
          theme: next.theme,
          locale: next.locale,
          grids: next.grids,
        };

        rows.set(principalId, stored);

        return Promise.resolve(stored);
      },
    },
  };
};

const createHarness = () => {
  const staff = createFakeTable();
  const user = createFakeTable();

  const repository = {
    staff: staff.repository,
    user: user.repository,
  } as unknown as SettingsRepository;

  const service = createSettingsService({
    repository,
    // The real one opens a database transaction; a unit test needs only that
    // the callback runs and its result is returned.
    transaction: (fn) => fn(undefined as never),
  });

  return { service, staff, user };
};

/* ── the pure merge ───────────────────────────────────────────────────────── */

describe("mergeGrids", () => {
  it("replaces the key it names and leaves every other alone", () => {
    const merged = mergeGrids(
      { staff: arrangement(200), users: arrangement(300) },
      { staff: arrangement(240) },
    );

    expect(merged.staff).toEqual(arrangement(240));
    expect(merged.users).toEqual(arrangement(300));
  });

  it("deletes on null, which is the only way an entry goes", () => {
    const merged = mergeGrids(
      { staff: arrangement(200), users: arrangement(300) },
      { staff: null },
    );

    expect(Object.keys(merged)).toEqual(["users"]);
  });

  it("is silence, not emptiness, when the patch names no grids", () => {
    // The property the whole merge exists for: a body says something about the
    // keys it names and nothing about the rest, so a client may send only what
    // changed and two tabs patching different grids both land.
    const current = { staff: arrangement(200) };

    expect(mergeGrids(current, undefined)).toEqual(current);
    expect(mergeGrids(current, {})).toEqual(current);
  });

  it("does not mutate what it was given", () => {
    const current = { staff: arrangement(200) };

    mergeGrids(current, { staff: null, users: arrangement(300) });

    expect(Object.keys(current)).toEqual(["staff"]);
  });
});

describe("applyPatch", () => {
  it("replaces the scalars that are present and keeps the ones that are not", () => {
    const next = applyPatch(
      { theme: "system", locale: "en", grids: {} },
      { theme: "dark" },
    );

    expect(next).toEqual({ theme: "dark", locale: "en", grids: {} });
  });
});

/* ── the service ──────────────────────────────────────────────────────────── */

describe("settings.get", () => {
  it("answers the defaults for a principal with no row, rather than a 404", async () => {
    const { service } = createHarness();

    await expect(service.get(staffContext())).resolves.toEqual({
      theme: "system",
      locale: "en",
      grids: {},
    });
  });

  it("answers the row once there is one", async () => {
    const { service, staff } = createHarness();

    staff.rows.set(STAFF_ID, {
      theme: "dark",
      locale: "en",
      grids: { staff: arrangement(240) },
    });

    await expect(service.get(staffContext())).resolves.toEqual({
      theme: "dark",
      locale: "en",
      grids: { staff: arrangement(240) },
    });
  });
});

describe("settings.update", () => {
  it("creates the row on the first patch and returns what was stored", async () => {
    const { service, staff } = createHarness();

    const result = await service.update(staffContext(), {
      theme: "light",
      grids: { staff: arrangement(240) },
    });

    expect(result).toEqual({
      theme: "light",
      locale: "en",
      grids: { staff: arrangement(240) },
    });
    expect(staff.rows.get(STAFF_ID)).toEqual(result);
  });

  it("merges against the locked row, not against what the caller last read", async () => {
    const { service, staff } = createHarness();

    await service.update(staffContext(), {
      grids: { staff: arrangement(200) },
    });
    await service.update(staffContext(), {
      grids: { users: arrangement(300) },
    });

    expect(staff.rows.get(STAFF_ID)?.grids).toEqual({
      staff: arrangement(200),
      users: arrangement(300),
    });
    // Locked on every write, which is what makes the sentence above true under
    // concurrency rather than only in a single-threaded test.
    expect(staff.locked).toEqual([STAFF_ID, STAFF_ID]);
  });

  it("refuses a patch that would leave more grids than the row may hold", async () => {
    const { service, staff } = createHarness();

    const existing = Object.fromEntries(
      Array.from({ length: MAX_SETTINGS_GRIDS }, (_, i) => [
        `g${String(i)}`,
        arrangement(200),
      ]),
    );

    staff.rows.set(STAFF_ID, {
      theme: "system",
      locale: "en",
      grids: existing,
    });

    // One more grid, in a body that is perfectly valid on its own: the bound
    // belongs to the merged row and only the service can see it.
    const failure = await service
      .update(staffContext(), { grids: { extra: arrangement(200) } })
      .catch((error: unknown) => error);

    expect(isAppError(failure) && failure.code).toBe("VALIDATION_ERROR");
    expect(isAppError(failure) && failure.details?.[0]?.path).toBe("grids");
  });

  it("lets a patch that deletes as many as it adds through the bound", async () => {
    const { service, staff } = createHarness();

    const existing = Object.fromEntries(
      Array.from({ length: MAX_SETTINGS_GRIDS }, (_, i) => [
        `g${String(i)}`,
        arrangement(200),
      ]),
    );

    staff.rows.set(STAFF_ID, {
      theme: "system",
      locale: "en",
      grids: existing,
    });

    const result = await service.update(staffContext(), {
      grids: { g0: null, extra: arrangement(200) },
    });

    expect(Object.keys(result.grids)).toHaveLength(MAX_SETTINGS_GRIDS);
    expect(result.grids.g0).toBeUndefined();
    expect(result.grids.extra).toEqual(arrangement(200));
  });

  it("writes a staff principal's settings to the staff half and no other", async () => {
    const { service, staff, user } = createHarness();

    await service.update(staffContext(), { theme: "dark" });

    expect(staff.rows.has(STAFF_ID)).toBe(true);
    expect(user.rows.size).toBe(0);
  });

  it("writes a user principal's settings to the user half and no other", async () => {
    const { service, staff, user } = createHarness();

    await service.update(userContext(), { theme: "dark" });

    expect(user.rows.has(USER_ID)).toBe(true);
    expect(staff.rows.size).toBe(0);
  });

  it("keeps two accounts that share an id across populations apart", async () => {
    // The ids cannot collide in practice, but the property being asserted is
    // that the *table* is chosen by population and not by the id: a staff
    // member and a customer are different accounts even when nothing about
    // the id says so (ADR-0017).
    const { service, staff, user } = createHarness();
    const sharedId = "33333333-3333-7333-8333-333333333333";

    await service.update(
      contextFor({
        kind: "staff",
        id: sharedId,
        roles: ["editor"],
        sessionId: "a",
      }),
      { theme: "dark" },
    );
    await service.update(
      contextFor({
        kind: "user",
        id: sharedId,
        roles: ["customer"],
        sessionId: "b",
      }),
      { theme: "light" },
    );

    expect(staff.rows.get(sharedId)?.theme).toBe("dark");
    expect(user.rows.get(sharedId)?.theme).toBe("light");
  });

  it("answers 401 rather than crashing when no principal reached the service", async () => {
    // Only reachable by mounting the router outside its guard, which is a
    // wiring mistake — but "we do not know who this is" is the right answer
    // either way, and a 500 would tell an anonymous caller the route exists
    // and is broken (ADR-0019).
    const { service } = createHarness();
    const anonymous = createRequestContext({
      requestId: "req-anon",
      logger: createLogger({ level: "silent", name: "test" }),
    });

    const failure = await service.get(anonymous).catch((e: unknown) => e);

    expect(isAppError(failure) && failure.status).toBe(401);
  });
});
