// `pnpm db:lane`'s slug and name rules (ADR-0082 §3). The database it creates
// is proved by the integration tiers that run on it, not here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  laneDatabaseName,
  MAX_DATABASE_NAME_BYTES,
  MAX_SLUG_LENGTH,
  slugBranch,
} from "./db-lane.mjs";

describe("slugBranch", () => {
  it("lane/D29 slugs to d29", () => {
    assert.equal(slugBranch("lane/D29"), "d29");
  });

  it("spike/d29-rls slugs to spike-d29-rls", () => {
    assert.equal(slugBranch("spike/d29-rls"), "spike-d29-rls");
  });

  it("main is refused", () => {
    assert.throws(() => slugBranch("main"), /main has no lane database/);
  });

  it("a detached HEAD is refused", () => {
    assert.throws(() => slugBranch("\n"), /no branch is checked out/);
  });

  it("a cloud session's branch keeps its prefix as a word", () => {
    assert.equal(
      slugBranch("claude/nifty-planck-bnxu4s\n"),
      "claude-nifty-planck-bnxu4s",
    );
  });

  it("runs of anything else collapse to one hyphen, trimmed", () => {
    assert.equal(slugBranch("Feature//Foo__Bar."), "feature-foo-bar");
  });

  it("lane/main is refused", () => {
    assert.throws(() => slugBranch("lane/main"), /slugs to main/);
  });

  it("a slug that fits carries no hash", () => {
    const branch = "a".repeat(MAX_SLUG_LENGTH);

    assert.equal(slugBranch(branch), branch);
  });

  it("truncated slugs of branches that differ past the cut differ", () => {
    const v1 = slugBranch("spike/d29-row-level-security-for-organizations-v1");
    const v2 = slugBranch("spike/d29-row-level-security-for-organizations-v2");

    assert.notEqual(v1, v2);
    for (const slug of [v1, v2]) {
      assert.ok(slug.length <= MAX_SLUG_LENGTH, slug);
      assert.match(slug, /^spike-d29-row-level-security-for-[0-9a-f]{6}$/);
    }
  });

  it("a truncated slug ends in the hash, with one hyphen before it", () => {
    const slug = slugBranch(
      `${"a".repeat(MAX_SLUG_LENGTH - 8)}-${"b".repeat(20)}`,
    );

    assert.match(slug, /^a+-[0-9a-f]{6}$/);
    assert.ok(slug.length <= MAX_SLUG_LENGTH);
  });

  it("is stable when applied to its own output", () => {
    const slug = slugBranch("spike/D29-RLS");

    assert.equal(slugBranch(slug), slug);
  });
});

describe("laneDatabaseName", () => {
  it("puts the lane between the name and the _test suffix", () => {
    assert.equal(laneDatabaseName("machxi_test", "d29"), "machxi_d29_test");
  });

  it("refuses a name longer than Postgres keeps", () => {
    const base = `${"x".repeat(MAX_DATABASE_NAME_BYTES - MAX_SLUG_LENGTH - 5)}_test`;

    assert.throws(
      () => laneDatabaseName(base, "a".repeat(MAX_SLUG_LENGTH)),
      /longer than the 63 bytes/,
    );
    assert.equal(
      Buffer.byteLength(
        laneDatabaseName("machxi_test", "a".repeat(MAX_SLUG_LENGTH)),
      ),
      MAX_SLUG_LENGTH + 12,
    );
  });

  it("refuses a base that is not a test database", () => {
    assert.throws(() => laneDatabaseName("machxi", "d29"), /does not end/);
  });
});
