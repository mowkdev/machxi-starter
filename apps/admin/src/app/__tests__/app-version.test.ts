import { describe, expect, it } from "vitest";

import { versionDefine } from "../../../app-version";

/**
 * The `define` the build installs (ADR-0081 §1–§3, `D32.2`; the label alone
 * since `D32.5`), read as the values a Docker build hands it.
 *
 * The footer's suites cannot reach this: the runner's `define` is built from
 * nothing set, so `dev` is all they ever see, and the labelled case replaces
 * the door below it. A build with no `--build-arg` still declares the `ARG`,
 * so what arrives there is the empty string — and a footer that read it as a
 * label would render nothing at all.
 */
describe("the build's define", () => {
  it("reads a blank label as dev", () => {
    expect(versionDefine({ APP_VERSION: "" })).toEqual({
      __APP_VERSION__: JSON.stringify("dev"),
    });
    expect(versionDefine({ APP_VERSION: " " })).toEqual({
      __APP_VERSION__: JSON.stringify("dev"),
    });
    expect(versionDefine({})).toEqual({
      __APP_VERSION__: JSON.stringify("dev"),
    });
  });

  it("passes a label through as given", () => {
    expect(versionDefine({ APP_VERSION: "v1.2.0" })).toEqual({
      __APP_VERSION__: JSON.stringify("v1.2.0"),
    });
  });

  it("installs no commit define, whatever the environment holds", () => {
    // `process.env` as a Docker build or a shell hands it: a `GIT_SHA` beside
    // the label is the API's fact, and nothing of it reaches this bundle.
    const environment: Record<string, string | undefined> = {
      APP_VERSION: "9.9.9",
      GIT_SHA: "0123456789abcdef",
    };
    const define = versionDefine(environment);

    expect(Object.keys(define)).toEqual(["__APP_VERSION__"]);
    expect(JSON.stringify(define)).not.toContain("0123456789abcdef");
  });
});
