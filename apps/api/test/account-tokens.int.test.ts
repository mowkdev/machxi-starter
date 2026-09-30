import { createLogger } from "@repo/logger";
import { sha256Base64url } from "@repo/crypto";
import { accountTokens } from "@repo/db";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRequestContext } from "../src/core/context/index.js";
import type { DbExecutor } from "../src/core/db/index.js";
import {
  createAccountTokensRepository,
  type AccountTokensRepository,
} from "../src/core/tokens/index.js";
import { createTestApp, type TestApp } from "./support/app.js";
import { resetAndSeed } from "./support/seed.js";

/**
 * `account_tokens` against real Postgres (ADR-0021, ADR-0071 §1).
 *
 * The three properties every mail flow leans on are properties of one
 * `update … where consumed_at is null returning` and of the transaction it
 * runs in, so they are proved here and not with a fake repository:
 *
 * 1. a token is **strictly single-use** — a second redemption updates no row;
 * 2. a mint **supersedes** the live token for the same principal and purpose,
 *    so "resend" leaves one working link rather than a growing set — and a
 *    second mint for that pair **waits**, which is what the advisory lock buys
 *    and what supersession would otherwise not survive under concurrency;
 * 3. a consume inside a transaction that **rolls back** spends nothing — the
 *    row is redeemable again, which is what makes "a refused operation costs
 *    the person nothing" true rather than hopeful;
 * 4. neither the purpose nor the population can be crossed, because both are
 *    matched inside the claiming statement rather than checked after it.
 *
 * `D18.2` amends the plan's step-2 done-when to say so: it named
 * `core/tokens/__tests__/tokens.test.ts` for all three, and a fake repository
 * asserting its own bookkeeping would prove none of them — the same correction
 * `D18.1` made when it moved the prune sweep's case to
 * `prune-sessions.int.test.ts`.
 *
 * The service under test is the **container's**, so the TTL map the
 * composition root builds out of `core/config` is exercised too. No account
 * rows are needed: `account_tokens` carries no foreign key (the principal is a
 * discriminated pair, ADR-0018's reason), and every consume looks its
 * principal up itself.
 */

describe("account tokens", () => {
  let harness: TestApp;
  /**
   * The same repository the container built, for the two cases that have to
   * hold the mint's lock from outside the mint.
   */
  let repository: AccountTokensRepository;

  const ctx = () =>
    createRequestContext({
      requestId: "01J0000000000000000000000A",
      logger: createLogger({ level: "silent", name: "tokens-int-test" }),
      ip: "203.0.113.7",
      userAgent: "vitest",
    });

  /** A fresh principal per case, so no two cases share a supersession. */
  const principal = () => ({ type: "user", id: randomUUID() }) as const;

  const transaction = <T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> =>
    harness.db.db.transaction(fn);

  const liveTokenCount = async (principalId: string): Promise<number> => {
    const rows = await harness.db.db
      .select({ id: accountTokens.id })
      .from(accountTokens)
      .where(
        and(
          eq(accountTokens.principalId, principalId),
          isNull(accountTokens.consumedAt),
        ),
      );

    return rows.length;
  };

  beforeAll(async () => {
    harness = createTestApp();
    repository = createAccountTokensRepository(harness.db.db);
    // Not for the fixtures — this file needs none — but so the table starts
    // empty whatever ran before it.
    await resetAndSeed({ hasher: harness.hasher });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("redeems once and refuses every replay", async () => {
    const who = principal();
    const { token } = await harness.container.accountTokens.mint(ctx(), {
      purpose: "verify_email",
      principal: who,
    });

    const first = await transaction((tx) =>
      harness.container.accountTokens.consume(
        ctx(),
        { purpose: "verify_email", principalType: "user", token },
        tx,
      ),
    );

    expect(first).toMatchObject({
      purpose: "verify_email",
      principalType: "user",
      principalId: who.id,
    });

    const second = await transaction((tx) =>
      harness.container.accountTokens.consume(
        ctx(),
        { purpose: "verify_email", principalType: "user", token },
        tx,
      ),
    );

    expect(second).toBeUndefined();
    expect(await liveTokenCount(who.id)).toBe(0);
  });

  it("refuses a token presented for another purpose", async () => {
    const who = principal();
    const { token } = await harness.container.accountTokens.mint(ctx(), {
      purpose: "verify_email",
      principal: who,
    });

    // The purpose is in the `where`, so one flow can never spend another's
    // credential — and the row survives the attempt.
    const wrong = await transaction((tx) =>
      harness.container.accountTokens.consume(
        ctx(),
        { purpose: "reset_password", principalType: "user", token },
        tx,
      ),
    );

    expect(wrong).toBeUndefined();
    expect(await liveTokenCount(who.id)).toBe(1);
  });

  it("refuses a token minted for the other population", async () => {
    const who = principal();
    const { token } = await harness.container.accountTokens.mint(ctx(), {
      purpose: "reset_password",
      principal: who,
    });

    // `reset_password` is minted for **both** populations (ADR-0071 §4 puts
    // the flow on both segments), so the purpose alone would leave a
    // customer's reset token claimable at the admin segment's endpoint and an
    // operator's at the customer's. The population is in the `where` for that
    // reason, and the row survives the attempt — a claim that had already
    // stamped the token would have spent it before any handler could object
    // (`D18.2`'s `security-reviewer`).
    const wrong = await transaction((tx) =>
      harness.container.accountTokens.consume(
        ctx(),
        { purpose: "reset_password", principalType: "staff", token },
        tx,
      ),
    );

    expect(wrong).toBeUndefined();
    expect(await liveTokenCount(who.id)).toBe(1);
  });

  it("supersedes the earlier link when one is re-minted", async () => {
    const who = principal();
    const first = await harness.container.accountTokens.mint(ctx(), {
      purpose: "verify_email",
      principal: who,
    });
    const second = await harness.container.accountTokens.mint(ctx(), {
      purpose: "verify_email",
      principal: who,
    });

    // Somebody clicked "resend": exactly one link works, and it is the new one.
    expect(await liveTokenCount(who.id)).toBe(1);

    const stale = await transaction((tx) =>
      harness.container.accountTokens.consume(
        ctx(),
        { purpose: "verify_email", principalType: "user", token: first.token },
        tx,
      ),
    );

    expect(stale).toBeUndefined();

    const fresh = await transaction((tx) =>
      harness.container.accountTokens.consume(
        ctx(),
        { purpose: "verify_email", principalType: "user", token: second.token },
        tx,
      ),
    );

    expect(fresh).toBeDefined();
  });

  it("makes a second mint for the same pair wait", async () => {
    const who = principal();
    const pair = {
      purpose: "verify_email",
      principalType: "user",
      principalId: who.id,
      at: new Date(),
    } as const;

    let minted = false;
    let pending: Promise<unknown> = Promise.resolve();

    // The lock is taken here the way a first mint would take it, and held
    // until this transaction commits. What is asserted is the thing that makes
    // supersession mean anything under concurrency: a second mint for the same
    // pair does not get to run its `update` against a snapshot taken before
    // the first one's row exists (`D18.2`'s two reviewers, independently).
    //
    // Deterministic on purpose. Two mints fired at once through `Promise.all`
    // pass with the lock *and* without it — the round trips happen not to
    // interleave — which is a test that cannot fail, so it is not the test.
    await harness.db.db.transaction(async (holder) => {
      await repository.lockPrincipalPurpose(pair, holder);

      pending = harness.container.accountTokens
        .mint(ctx(), { purpose: "verify_email", principal: who })
        .then(() => {
          minted = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(minted).toBe(false);
    });

    await pending;

    expect(minted).toBe(true);
    expect(await liveTokenCount(who.id)).toBe(1);
  });

  it("does not make a mint for another principal wait", async () => {
    const holderPrincipal = principal();
    const other = principal();

    // The key is the pair, not the table: one person's resend must not queue
    // behind another's.
    await harness.db.db.transaction(async (holder) => {
      await repository.lockPrincipalPurpose(
        {
          purpose: "verify_email",
          principalType: "user",
          principalId: holderPrincipal.id,
          at: new Date(),
        },
        holder,
      );

      await harness.container.accountTokens.mint(ctx(), {
        purpose: "verify_email",
        principal: other,
      });
    });

    expect(await liveTokenCount(other.id)).toBe(1);
  });

  it("leaves a token of another purpose alone when one is re-minted", async () => {
    const who = principal();

    await harness.container.accountTokens.mint(ctx(), {
      purpose: "verify_email",
      principal: who,
    });
    await harness.container.accountTokens.mint(ctx(), {
      purpose: "reset_password",
      principal: who,
    });
    await harness.container.accountTokens.mint(ctx(), {
      purpose: "reset_password",
      principal: who,
    });

    // The supersession is per principal *and* purpose: asking to reset a
    // password must not quietly invalidate the verification link somebody is
    // about to click.
    expect(await liveTokenCount(who.id)).toBe(2);
  });

  it("spends nothing when the transaction around the consume rolls back", async () => {
    const who = principal();
    const { token } = await harness.container.accountTokens.mint(ctx(), {
      purpose: "reset_password",
      principal: who,
    });

    const failure = new Error("the flow refused after claiming the token");

    await expect(
      transaction(async (tx) => {
        const claimed = await harness.container.accountTokens.consume(
          ctx(),
          { purpose: "reset_password", principalType: "user", token },
          tx,
        );

        expect(claimed).toBeDefined();

        // What a real flow does when the principal turns out to be gone,
        // disabled or already changed: it throws, and ADR-0071 §1's rule is
        // that the token is not spent by an operation that did not happen.
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(await liveTokenCount(who.id)).toBe(1);

    const afterwards = await transaction((tx) =>
      harness.container.accountTokens.consume(
        ctx(),
        { purpose: "reset_password", principalType: "user", token },
        tx,
      ),
    );

    expect(afterwards).toBeDefined();
  });

  it("refuses a token past its expiry, and leaves it unconsumed", async () => {
    const who = principal();
    const { token } = await harness.container.accountTokens.mint(ctx(), {
      purpose: "reset_password",
      principal: who,
    });

    // The TTL comes from configuration, so the row is aged rather than the
    // clock: the expiry is moved into the past exactly as time passing would.
    await harness.db.db
      .update(accountTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accountTokens.principalId, who.id));

    const expired = await transaction((tx) =>
      harness.container.accountTokens.consume(
        ctx(),
        { purpose: "reset_password", principalType: "user", token },
        tx,
      ),
    );

    expect(expired).toBeUndefined();
    // Left unconsumed rather than stamped: the sweep deletes it either way,
    // and stamping would make `consumed_at` mean two different things.
    expect(await liveTokenCount(who.id)).toBe(1);
  });

  it("stores the hash and never the token", async () => {
    const who = principal();
    const { token } = await harness.container.accountTokens.mint(ctx(), {
      purpose: "change_email",
      principal: who,
      payload: { newEmail: "new@machxi.local" },
    });

    const [row] = await harness.db.db
      .select({
        tokenHash: accountTokens.tokenHash,
        payload: accountTokens.payload,
      })
      .from(accountTokens)
      .where(eq(accountTokens.principalId, who.id));

    // The digest itself, not merely "something other than the token": the
    // weaker assertion passes for a truncation, a reversal or a constant
    // (`D18.2`'s `code-reviewer`).
    expect(row?.tokenHash).toBe(sha256Base64url(token));

    // The payload survives the round trip, which is the whole reason the
    // column exists: `confirm-email` reads the new address off the row it
    // consumed rather than trusting a body (ADR-0071 §6).
    const consumed = await transaction((tx) =>
      harness.container.accountTokens.consume(
        ctx(),
        { purpose: "change_email", principalType: "user", token },
        tx,
      ),
    );

    expect(consumed?.payload).toEqual({ newEmail: "new@machxi.local" });
  });
});
