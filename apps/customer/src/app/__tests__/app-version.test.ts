import { describe, expect, it } from "vitest";

import { versionDefine } from "../../../app-version";

/**
 * The `define` the build installs (ADR-0081 §1–§2, `D32.2`), read as the
 * values a Docker build hands it.
 *
 * The footer's suites cannot reach this: the runner's `define` is built from
 * nothing set, so `undefined` is all they ever see, and the labelled case
 * replaces the door below it. A build with no `--build-arg` still declares
 * the `ARG`, so what arrives there is the empty string — and a footer that
 * read it as a label would render nothing at all.
 */
describe("the build's define", () => {
  it("reads a blank label as dev and a blank commit as none", () => {
    expect(versionDefine({ APP_VERSION: "", GIT_SHA: " " })).toEqual({
      __APP_VERSION__: JSON.stringify("dev"),
      __GIT_SHA__: JSON.stringify(""),
    });
    expect(versionDefine({})).toEqual({
      __APP_VERSION__: JSON.stringify("dev"),
      __GIT_SHA__: JSON.stringify(""),
    });
  });

  it("passes a label and a commit through as given", () => {
    expect(
      versionDefine({ APP_VERSION: "v1.2.0", GIT_SHA: "0123456789abcdef" }),
    ).toEqual({
      __APP_VERSION__: JSON.stringify("v1.2.0"),
      __GIT_SHA__: JSON.stringify("0123456789abcdef"),
    });
  });
});
