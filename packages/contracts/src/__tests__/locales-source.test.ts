import { describe, expect, it } from "vitest";

import {
  CUSTOM_MESSAGES,
  CUSTOM_MESSAGE_KEYS,
  changePasswordBody,
  createCustomMessageError,
  customRule,
  staffRolesSchema,
  updateStaffBody,
  type CustomMessageKey,
} from "../index.js";

/**
 * The keyed custom messages (ADR-0046 §6, `D7.5`).
 *
 * Two properties are worth a test and neither is obvious from reading the
 * module. The first is that **the source sentences did not move**: this package
 * stopped writing them on the refinements and a `400` must be byte-identical
 * anyway, because the API emits them and Postman asserts them. The second is
 * that a **translating map replaces them without the schema knowing**, which is
 * the whole reason the sentences left the refinements.
 */

describe("the source custom messages", () => {
  it("emits the source sentence for every keyed rule, as it always did", () => {
    expect(
      staffRolesSchema.safeParse(["admin", "admin"]).error?.issues[0],
    ).toMatchObject({ message: "Roles must not repeat" });
    expect(updateStaffBody.safeParse({}).error?.issues[0]).toMatchObject({
      message: "Provide at least one field to update",
    });
    expect(
      changePasswordBody.safeParse({
        currentPassword: "same-password-12",
        newPassword: "same-password-12",
      }).error?.issues[0],
    ).toMatchObject({
      path: ["newPassword"],
      message: "The new password must differ from the current one",
    });
  });

  it("carries the key on the issue, so a client can re-derive it", () => {
    const issue = staffRolesSchema.safeParse(["admin", "admin"]).error
      ?.issues[0];

    expect(issue?.code).toBe("custom");
    expect(issue).toMatchObject({ params: { i18n: "rolesUnique" } });
  });

  it("keeps every key answered by the catalogue", () => {
    for (const key of CUSTOM_MESSAGE_KEYS) {
      expect(CUSTOM_MESSAGES[key]).toBeTruthy();
    }

    expect(CUSTOM_MESSAGE_KEYS).toHaveLength(
      Object.keys(CUSTOM_MESSAGES).length,
    );
  });

  it("hands a translator the key and prefers its answer", () => {
    const map = createCustomMessageError((key) =>
      key === "rolesUnique" ? "Lomas nedrīkst atkārtoties" : undefined,
    );

    expect(
      map({
        code: "custom",
        input: [],
        params: { i18n: "rolesUnique" },
      } as never),
    ).toBe("Lomas nedrīkst atkārtoties");
  });

  it("falls back to the source when the translator has no entry", () => {
    const map = createCustomMessageError(() => undefined);

    expect(
      map({
        code: "custom",
        input: [],
        params: { i18n: "updateNotEmpty" },
      } as never),
    ).toBe("Provide at least one field to update");
  });

  /**
   * The narrowness is the safety: installing this map at `customError` must not
   * change any message it does not own, or a consumer's own `.refine()` would
   * silently start reading out of this catalogue.
   */
  it("declines every issue that is not one of ours", () => {
    const map = createCustomMessageError();

    expect(
      map({ code: "too_small", origin: "string", minimum: 1 } as never),
    ).toBeUndefined();
    expect(map({ code: "custom", input: null } as never)).toBeUndefined();
    expect(
      map({ code: "custom", input: null, params: { i18n: "nope" } } as never),
    ).toBeUndefined();
    expect(
      map({ code: "custom", input: null, params: { other: 1 } } as never),
    ).toBeUndefined();
  });

  it("spells a rule as the key alone", () => {
    expect(customRule("passwordMustDiffer")).toEqual({
      params: { i18n: "passwordMustDiffer" },
    });

    const key: CustomMessageKey = "rolesUnique";

    expect(CUSTOM_MESSAGES[key]).toBe("Roles must not repeat");
  });
});
