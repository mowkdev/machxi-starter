import {
  createOrganizationAdminBody,
  listOrganizationsQuery,
  updateOrganizationBody,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

import { EN_RESOURCES, NAMESPACES, createI18n } from "@/shared/i18n";
import { assertConfigMatchesContract } from "@/shared/resource/config";

import { organizationResourceConfig } from "../organization.config";

/**
 * The config against the contract (ADR-0035 §Consequences, ADR-0063 §2).
 *
 * Half of ADR-0035's promise is the compiler's since the config carries its
 * types: a column that is not a field of `OrganizationResource`, a field
 * neither body has room for, an `errorFields` entry naming a box no form draws
 * are compile errors on the lines that write them. The other half is the
 * endpoint's allow-lists, which no type can reach, and that is this one shared
 * assertion — `@repo/resource`'s own suite proves it fails, so this file is the
 * resource saying *which* endpoint it claims to describe.
 *
 * Both directions are checked: a column that could be sortable and is not costs
 * an operator a feature, and one that claims a sort the endpoint refuses costs
 * them a broken one.
 */

const t = createI18n({
  resources: { en: EN_RESOURCES },
  namespaces: NAMESPACES,
  locale: "en",
}).instance.getFixedT(null, "common");

describe("the organizations config against its endpoint", () => {
  it("agrees with listOrganizationsQuery, createOrganizationAdminBody and updateOrganizationBody", () => {
    /*
     * `not.toThrow` rather than a bare call: the assertion reports every
     * violation it found in one message, and this is what puts that message in
     * the report instead of leaving a test that asserts nothing on its face.
     */
    expect(() => {
      assertConfigMatchesContract(organizationResourceConfig, {
        listQuery: listOrganizationsQuery,
        createBody: createOrganizationAdminBody,
        updateBody: updateOrganizationBody,
        /*
         * Values the contract has an opinion about, per field — fixture data
         * rather than a claim. A field whose schema is a policy rather than a
         * word (an email, a password) needs an entry here; a plain word does
         * not.
         */
        /*
         * `common:options.<value>` is composed at runtime, deliberately, so a
         * config never restates a tuple ADR-0023 declares once — and a missing
         * entry degrades to `humanize`, a plausible English word in grey. The
         * dictionary is the app's, so the app answers and the assertion asks.
         */
        /*
         * The two the generic sampler cannot guess. `"Sample"` is not a uuid
         * and not a slug, and both fields validate as one — so without these
         * the assertion would report the config as disagreeing with a contract
         * it agrees with perfectly.
         */
        samples: {
          ownerId: "0198c1f0-0000-7000-8000-00000000f001",
          slug: "sample-organization",
        },
        optionLabelled: (value) =>
          t(`options.${value}` as "options.active") !== `options.${value}`,
      });
    }).not.toThrow();
  });
});
