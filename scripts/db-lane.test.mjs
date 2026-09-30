// `pnpm db:lane`'s slug and name rules (ADR-0082 §3). The database it creates
// is proved by the integration tiers that run on it, not here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { laneDatabaseName, MAX_SLUG_LENGTH, slugBranch } from "./db-lane.mjs";

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

  it("is capped without ending on a hyphen", () => {
    const slug = slugBranch(`${"a".repeat(MAX_SLUG_LENGTH - 1)}-bcd`);

    assert.equal(slug, "a".repeat(MAX_SLUG_LENGTH - 1));
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

  it("refuses a base that is not a test database", () => {
    assert.throws(() => laneDatabaseName("machxi", "d29"), /does not end/);
  });
});
