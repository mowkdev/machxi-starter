import { describe, expect, it } from "vitest";

import { describeTarget } from "../tooling/report.js";

/**
 * ADR-0008 §Environment guardrails: "every db script prints the target
 * host/db name (never credentials) before acting". The second half is the
 * part worth testing.
 */
describe("describeTarget", () => {
  it("renders host, port and database", () => {
    expect(
      describeTarget("postgres://machxi:machxi@localhost:5432/machxi"),
    ).toBe("localhost:5432/machxi");
  });

  it("never echoes the password", () => {
    const rendered = describeTarget(
      "postgres://admin:sup3r-s3cret@db.internal:6432/production",
    );

    expect(rendered).toBe("db.internal:6432/production");
    expect(rendered).not.toContain("sup3r-s3cret");
    expect(rendered).not.toContain("admin");
  });

  it("does not leak a password that happens to look like the host", () => {
    // A redaction implemented by string substitution would either mangle the
    // host or miss the password here; reading the URL's fields cannot.
    expect(describeTarget("postgres://u:localhost@localhost:5432/db")).toBe(
      "localhost:5432/db",
    );
  });

  it("assumes the default port when none is given", () => {
    expect(describeTarget("postgres://u:p@db.internal/machxi")).toBe(
      "db.internal:5432/machxi",
    );
  });

  it("marks a missing database rather than rendering a bare host", () => {
    expect(describeTarget("postgres://u:p@db.internal:5432/")).toBe(
      "db.internal:5432/?",
    );
  });

  it("refuses to echo a malformed connection string", () => {
    // The malformed string is the one that still contains the password.
    expect(describeTarget("not a url: pass=hunter2")).toBe(
      "<unparsable connection string>",
    );
  });

  it("keeps query parameters out of the summary", () => {
    expect(
      describeTarget("postgres://u:p@db.internal:5432/machxi?sslmode=require"),
    ).toBe("db.internal:5432/machxi");
  });
});
