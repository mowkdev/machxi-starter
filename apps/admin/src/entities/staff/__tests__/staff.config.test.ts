import {
  createStaffBody,
  listStaffQuery,
  updateStaffBody,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { EN_RESOURCES, NAMESPACES, createI18n } from "@/shared/i18n";
import { assertConfigMatchesContract } from "@/shared/resource/config";

import { staffResourceConfig } from "../staff.config";

/**
 * The config against the contract (ADR-0035 §Consequences, ADR-0063 §2).
 *
 * **This file used to be 367 lines and is now a call**, which is the whole of
 * the trade `D14.10` makes. Half of what it asserted is the compiler's since
 * this resource's config carries its types — a column that is not a field of
 * `StaffResource`, a field neither `createStaffBody` nor `updateStaffBody` has
 * room for, an `errorFields` entry naming a box no form draws are all compile
 * errors on the lines that write them. The other half is the endpoint's
 * allow-lists, which no type can reach, and that is one shared assertion now
 * rather than one suite per resource: `@repo/resource`'s own suite proves it
 * fails, so this is the resource saying *which* endpoint it claims to describe.
 *
 * The claim is unchanged and worth restating: every `sortable` and every
 * `filter` in the config is an assertion about `listStaffQuery`, and every
 * field is an assertion about one of the two bodies. Both directions are
 * checked — a column that could be sortable and is not costs an operator a
 * feature, and a column that claims it and is not costs them a broken one.
 */

const t = createI18n({
  resources: { en: EN_RESOURCES },
  namespaces: NAMESPACES,
  locale: "en",
}).instance.getFixedT(null, "common");

describe("the staff config against its endpoint", () => {
  it("agrees with listStaffQuery, createStaffBody and updateStaffBody", () => {
    /*
     * `not.toThrow` rather than a bare call: the assertion reports every
     * violation it found in one message, and this is what puts that message in
     * the report instead of leaving a test that asserts nothing on its face.
     */
    expect(() => {
      assertConfigMatchesContract(staffResourceConfig, {
        listQuery: listStaffQuery,
        createBody: createStaffBody,
        updateBody: updateStaffBody,
        /*
         * The two values the contract has an opinion about. `email` is an
         * `emailSchema` and `password` a policy, so a plain word parses as
         * neither; everything else samples its own options or a word.
         */
        samples: {
          email: "new.operator@machxi.local",
          password: "DevPassword!123",
        },
        /*
         * `common:options.<value>` is composed at runtime, deliberately, so that
         * a config never restates a tuple ADR-0023 declares once — and a missing
         * entry degrades to `humanize`, a plausible English word in grey. The
         * dictionary is the app's, so the app answers and the assertion asks.
         */
        optionLabelled: (value) =>
          t(`options.${value}` as "options.active") !== `options.${value}`,
      });
    }).not.toThrow();
  });
});
