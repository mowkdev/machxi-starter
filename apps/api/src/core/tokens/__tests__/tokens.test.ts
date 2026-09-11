import type { TokenPurpose } from "@repo/contracts";
import { sha256Base64url } from "@repo/crypto";
import { createLogger } from "@repo/logger";
import { describe, expect, it, vi } from "vitest";

import { createRequestContext } from "../../context/index.js";
import type { DbExecutor } from "../../db/index.js";
import {
  MAX_TOKEN_USER_AGENT_LENGTH,
  createAccountTokens,
  type AccountTokenRow,
  type AccountTokensRepository,
} from "../index.js";

/**
 * The mint and the consume, as decisions rather than as SQL (ADR-0071 §1).
 *
 * What a fake repository can prove is exactly what this service decides: that
 * the raw token leaves in the return value and only its hash is handed to the
 * database, that the expiry comes from the *purpose's* own TTL, that the
 * supersession happens before the insert and on the same executor, and that a
 * consume runs on the caller's transaction and matches on its purpose.
 *
 * What it cannot prove is single use, supersession and rollback, which are
 * properties of one `update … where consumed_at is null` against a real
 * Postgres — `apps/api/test/account-tokens.int.test.ts` proves those, for the
 * reason `prune-sessions.int.test.ts` proves a deletion path there
 * (`D18.2`, amending the plan's step-2 done-when).
 */

/** Marks the executor a caller passed in, so a pass-through is checkable. */
const CALLER_TX = { id: "caller-tx" } as unknown as DbExecutor;
/** Marks the one this service opened for itself. */
const OWN_TX = { id: "own-tx" } as unknown as DbExecutor;

interface Recorded {
  readonly name:
    "insert" | "consume" | "supersedeLive" | "lockPrincipalPurpose";
  readonly input: Record<string, unknown>;
  readonly tx: DbExecutor | undefined;
}

const createFakeRepository = (consumed?: AccountTokenRow) => {
  const calls: Recorded[] = [];

  const repository: AccountTokensRepository = {
    insert: (row, tx) => {
      calls.push({ name: "insert", input: { ...row }, tx });

      return Promise.resolve({
        id: "token-row-id",
        purpose: row.purpose,
        principalType: row.principalType,
        principalId: row.principalId,
        payload: row.payload ?? null,
      });
    },
    consume: (input, tx) => {
      calls.push({ name: "consume", input: { ...input }, tx });

      return Promise.resolve(consumed);
    },
    supersedeLive: (input, tx) => {
      calls.push({ name: "supersedeLive", input: { ...input }, tx });

      return Promise.resolve(1);
    },
    lockPrincipalPurpose: (input, tx) => {
      calls.push({ name: "lockPrincipalPurpose", input: { ...input }, tx });

      return Promise.resolve();
    },
  };

  return { repository, calls } as const;
};

const TTLS: Record<TokenPurpose, number> = {
  verify_email: 24 * 3600,
  reset_password: 3600,
  change_email: 900,
  staff_onboarding: 7 * 86400,
  federated_login: 60,
};

const NOW = new Date("2026-09-10T12:00:00.000Z");

const createContext = (userAgent?: string) => {
  const ctx = createRequestContext({
    requestId: "01J0000000000000000000000A",
    logger: createLogger({ level: "silent", name: "tokens-test" }),
    ip: "203.0.113.7",
    ...(userAgent === undefined ? {} : { userAgent }),
  });

  return {
    ctx,
    info: vi.spyOn(ctx.logger, "info"),
    warn: vi.spyOn(ctx.logger, "warn"),
  } as const;
};

const build = (
  repository: AccountTokensRepository,
  newToken = () => "the-raw-token",
) =>
  createAccountTokens({
    repository,
    ttlSecByPurpose: TTLS,
    transaction: (fn) => fn(OWN_TX),
    now: () => NOW,
    newToken,
  });

const principal = { type: "user", id: "user-1" } as const;

describe("mint", () => {
  it("returns the raw token once and stores only its hash", async () => {
    const { repository, calls } = createFakeRepository();
    const { ctx } = createContext();

    const minted = await build(repository).mint(ctx, {
      purpose: "verify_email",
      principal,
    });

    expect(minted.token).toBe("the-raw-token");

    const insert = calls.find((call) => call.name === "insert");

    // The whole storage rule of ADR-0071 §1 in two assertions: the digest is
    // written, and the credential itself appears nowhere the database can see.
    expect(insert?.input.tokenHash).toBe(sha256Base64url("the-raw-token"));
    expect(JSON.stringify(insert?.input)).not.toContain("the-raw-token");
  });

  it("expires the link on the purpose's own TTL, not on a shared one", async () => {
    const { repository } = createFakeRepository();
    const { ctx } = createContext();
    const tokens = build(repository);

    // Four windows answering four questions (ADR-0071 §1): a reset link that
    // inherited the verification link's day would be a takeover credential
    // lying around for 24 hours.
    const verify = await tokens.mint(ctx, {
      purpose: "verify_email",
      principal,
    });
    const reset = await tokens.mint(ctx, {
      purpose: "reset_password",
      principal,
    });

    expect(verify.expiresAt).toEqual(
      new Date(NOW.getTime() + TTLS.verify_email * 1000),
    );
    expect(reset.expiresAt).toEqual(
      new Date(NOW.getTime() + TTLS.reset_password * 1000),
    );
  });

  it("locks the pair, supersedes, then inserts — all on one executor", async () => {
    const { repository, calls } = createFakeRepository();
    const { ctx } = createContext();

    await build(repository).mint(ctx, { purpose: "verify_email", principal });

    // Order is the property, and all three of it: the lock is taken before
    // anything is read, so a second mint for the same pair waits rather than
    // superseding a row it cannot see; and a supersession that committed after
    // its replacement would leave the person with no redeemable link at all.
    expect(calls.map((call) => call.name)).toEqual([
      "lockPrincipalPurpose",
      "supersedeLive",
      "insert",
    ]);
    expect(calls.every((call) => call.tx === OWN_TX)).toBe(true);
    expect(calls[0]?.input).toMatchObject({
      purpose: "verify_email",
      principalType: "user",
      principalId: "user-1",
      at: NOW,
    });
  });

  it("runs both statements on a transaction the caller already has", async () => {
    const { repository, calls } = createFakeRepository();
    const { ctx } = createContext();

    // Registration's shape: the account and the link it mails commit together
    // or not at all.
    await build(repository).mint(
      ctx,
      { purpose: "verify_email", principal },
      CALLER_TX,
    );

    expect(calls.every((call) => call.tx === CALLER_TX)).toBe(true);
  });

  it("carries the payload the change-of-address flow needs", async () => {
    const { repository, calls } = createFakeRepository();
    const { ctx } = createContext();

    await build(repository).mint(ctx, {
      purpose: "change_email",
      principal,
      payload: { newEmail: "new@machxi.local" },
    });

    expect(calls.find((call) => call.name === "insert")?.input.payload).toEqual(
      {
        newEmail: "new@machxi.local",
      },
    );
  });

  it("bounds the user agent and never logs the token", async () => {
    const { repository, calls } = createFakeRepository();
    const { ctx, info } = createContext("u".repeat(1000));

    await build(repository).mint(ctx, { purpose: "verify_email", principal });

    expect(calls.find((call) => call.name === "insert")?.input.userAgent).toBe(
      "u".repeat(MAX_TOKEN_USER_AGENT_LENGTH),
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "verify_email", superseded: 1 }),
      expect.any(String),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("the-raw-token");
  });
});

describe("consume", () => {
  const row: AccountTokenRow = {
    id: "token-row-id",
    purpose: "reset_password",
    principalType: "user",
    principalId: "user-1",
    payload: null,
  };

  it("looks the token up by hash, purpose and population, on the caller's transaction", async () => {
    const { repository, calls } = createFakeRepository(row);
    const { ctx } = createContext();

    const consumed = await build(repository).consume(
      ctx,
      {
        purpose: "reset_password",
        principalType: "user",
        token: "the-raw-token",
      },
      CALLER_TX,
    );

    expect(consumed).toEqual(row);
    // The population travels into the claiming statement, not onto a check of
    // the row it returns: `reset_password` exists on both segments, and an
    // update that has stamped a token has already spent it.
    expect(calls[0]).toMatchObject({
      name: "consume",
      tx: CALLER_TX,
      input: {
        purpose: "reset_password",
        principalType: "user",
        tokenHash: sha256Base64url("the-raw-token"),
        at: NOW,
      },
    });
  });

  it("answers undefined and logs nothing identifying when nothing is redeemable", async () => {
    const { repository } = createFakeRepository(undefined);
    const { ctx, warn } = createContext();

    const consumed = await build(repository).consume(
      ctx,
      {
        purpose: "reset_password",
        principalType: "user",
        token: "a-dead-token",
      },
      CALLER_TX,
    );

    expect(consumed).toBeUndefined();
    // Unknown, wrong purpose, wrong population, already consumed and expired
    // are one answer, and the line that records the refusal names neither the
    // token nor whose it might have been: every endpoint that consumes is
    // anonymous.
    expect(warn).toHaveBeenCalledWith(
      { purpose: "reset_password", principalType: "user" },
      expect.any(String),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("a-dead-token");
  });
});
