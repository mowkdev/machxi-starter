import {
  createUserBody,
  listUsersQuery,
  updateUserBody,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { EN_RESOURCES, NAMESPACES, createI18n } from "@/shared/i18n";
import { assertConfigMatchesContract } from "@/shared/resource/config";

import { userResourceConfig } from "../user.config";

/**
 * The config against the contract (ADR-0035 §Consequences, ADR-0063 §2).
 *
 * The staff suite carries the reasoning; this is the same call over the other
 * resource, and the four ways this config differs from that one are properties
 * of `listUsersQuery` and the two user bodies rather than style choices — which
 * is the argument for declaring resources as data in the first place, and the
 * reason one assertion serves both.
 *
 * Two of those differences are now the *type's* to check rather than this
 * file's: `deletedAt` is a column and not a field because `UserResource` has it
 * and neither body does, and `roles` is a column and not a field because
 * `USER_ROLES` has one member in v1 (see the config's own note). What stays
 * here is what only the endpoint knows — that `deletedAt` may be filtered on
 * `null` and not sorted, that names accept `null` to clear them, and that the
 * hot filters press into filters the API allow-lists.
 */

const t = createI18n({
  resources: { en: EN_RESOURCES },
  namespaces: NAMESPACES,
  locale: "en",
}).instance.getFixedT(null, "common");

describe("the users config against its endpoint", () => {
  it("agrees with listUsersQuery, createUserBody and updateUserBody", () => {
    /*
     * `not.toThrow` rather than a bare call: the assertion reports every
     * violation it found in one message, and this is what puts that message in
     * the report instead of leaving a test that asserts nothing on its face.
     */
    expect(() => {
      assertConfigMatchesContract(userResourceConfig, {
        listQuery: listUsersQuery,
        createBody: createUserBody,
        updateBody: updateUserBody,
        samples: {
          email: "new.customer@example.test",
          password: "DevPassword!123",
        },
        optionLabelled: (value) =>
          t(`options.${value}` as "options.active") !== `options.${value}`,
      });
    }).not.toThrow();
  });
});
