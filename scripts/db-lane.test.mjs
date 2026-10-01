// `pnpm db:lane`'s slug and name rules (ADR-0082 §3). The database it creates
// is proved by the integration tiers that run on it, not here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  laneDatabaseName,
  MAX_DATABASE_NAME_BYTES,
  slugBranch,
  slugCap,
} from "./db-lane.mjs";

/**
 * The product's own test database, as the committed `.env.test` names it. A
 * fork's rename rewrites it, and every case below derives what it asserts
 * from it, so the cases hold whatever the product is called (ADR-0084 §1).
 */
const BASE = "machxi_test";

/** The longest slug a lane beside `BASE` carries. */
const CAP = slugCap(BASE);

const slug = (branch) => slugBranch(branch, CAP);

describe("slugBranch", () => {
  it("lane/D29 slugs to d29", () => {
    assert.equal(slug("lane/D29"), "d29");
  });

  it("spike/d29-rls slugs to spike-d29-rls", () => {
    assert.equal(slug("spike/d29-rls"), "spike-d29-rls");
  });

  it("main is refused", () => {
    assert.throws(() => slug("main"), /main has no lane database/);
  });

  it("a detached HEAD is refused", () => {
    assert.throws(() => slug("\n"), /no branch is checked out/);
  });

  it("a cloud session's branch keeps its prefix as a word", () => {
    assert.equal(
      slug("claude/nifty-planck-bnxu4s\n"),
      "claude-nifty-planck-bnxu4s",
    );
  });

  it("runs of anything else collapse to one hyphen, trimmed", () => {
    assert.equal(slug("Feature//Foo__Bar."), "feature-foo-bar");
  });

  it("lane/main is refused", () => {
    assert.throws(() => slug("lane/main"), /slugs to main/);
  });

  it("a slug that fits carries no hash", () => {
    const branch = "a".repeat(CAP);

    assert.equal(slug(branch), branch);
  });

  it("truncated slugs of branches that differ past the cut differ", () => {
    const head = `spike/d29-${"x".repeat(CAP)}`;
    const v1 = slug(`${head}-v1`);
    const v2 = slug(`${head}-v2`);

    assert.notEqual(v1, v2);
    for (const got of [v1, v2]) {
      assert.equal(got.length, CAP, got);
      assert.match(got, /^spike-d29-x+-[0-9a-f]{6}$/);
    }
  });

  it("a truncated slug ends in the hash, with one hyphen before it", () => {
    const got = slug(`${"a".repeat(CAP - 8)}-${"b".repeat(20)}`);

    assert.match(got, /^a+-[0-9a-f]{6}$/);
    assert.ok(got.length <= CAP);
  });

  it("is stable when applied to its own output", () => {
    const got = slug("spike/D29-RLS");

    assert.equal(slug(got), got);
  });
});

describe("slugCap", () => {
  it("is what the base and the joining underscore leave of 63 bytes", () => {
    assert.equal(
      slugCap(BASE),
      MAX_DATABASE_NAME_BYTES - Buffer.byteLength(BASE) - 1,
    );
  });

  it("a product name of 32 characters still gets a lane database for an ordinary branch", () => {
    // The longest name `scripts/rename.mjs` accepts.
    const base = `${"p".repeat(32)}_test`;
    const cap = slugCap(base);

    for (const branch of [
      "claude/nifty-planck-bnxu4s",
      "lane/D36",
      `spike/${"a".repeat(60)}`,
    ]) {
      const name = laneDatabaseName(base, slugBranch(branch, cap));

      assert.ok(name.endsWith("_test"), name);
      assert.ok(Buffer.byteLength(name) <= MAX_DATABASE_NAME_BYTES, name);
    }
    assert.equal(
      laneDatabaseName(base, slugBranch("lane/D36", cap)),
      `${"p".repeat(32)}_d36_test`,
    );
    // A cloud session's branch is kept to what fits, and ends in its hash.
    assert.match(
      slugBranch("claude/nifty-planck-bnxu4s", cap),
      /^claude-nifty-planc-[0-9a-f]{6}$/,
    );
  });

  it("refuses a base that leaves no room for a hashed slug", () => {
    assert.throws(() => slugCap(`${"p".repeat(55)}_test`), /shorten/);
  });
});

describe("laneDatabaseName", () => {
  it("puts the lane between the name and the _test suffix", () => {
    assert.equal(
      laneDatabaseName(BASE, "d29"),
      `${BASE.slice(0, -"_test".length)}_d29_test`,
    );
  });

  it("refuses a name longer than Postgres keeps", () => {
    assert.throws(
      () => laneDatabaseName(BASE, "a".repeat(CAP + 1)),
      /longer than the 63 bytes/,
    );
    // The longest slug the cap allows fills the 63 bytes exactly: the base's
    // bytes, the slug's and the one joining underscore.
    assert.equal(
      Buffer.byteLength(laneDatabaseName(BASE, "a".repeat(CAP))),
      MAX_DATABASE_NAME_BYTES,
    );
  });

  it("refuses a base that is not a test database", () => {
    assert.throws(
      () => laneDatabaseName(BASE.slice(0, -"_test".length), "d29"),
      /does not end/,
    );
  });
});
