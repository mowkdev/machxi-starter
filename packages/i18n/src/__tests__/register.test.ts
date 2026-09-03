import { describe, expect, it } from "vitest";

import { createI18n } from "../create-i18n";
import { createRegister } from "../register";

/**
 * §13's `register(i18n)`, exercised (`D9.2`, ADR-0046 §13, ADR-0051).
 *
 * **The mechanism ships before its first real consumer, so its contract is
 * pinned here rather than left to be discovered at `D9.4`.** ADR-0047's rule
 * is that a slot with no consumer is a defect this repository has recorded
 * twice; a suite is the consumer that keeps this one honest until the grid's
 * namespace arrives. What it has to prove is exactly the two things a package
 * author would otherwise get wrong: that the bundle actually resolves through
 * the instance afterwards, and that registering cannot clobber an app's own
 * copy.
 */

const instanceWith = (en: Record<string, object>) =>
  createI18n({
    resources: { en },
    // A prefix an app would supply (ADR-0064 §1); nothing here reads it back.
    storageKeyPrefix: "test.admin",
    namespaces: Object.keys(en),
    locale: "en",
  });

describe("createRegister", () => {
  it("adds a package's namespace to an instance the app already built", () => {
    const i18n = instanceWith({ common: { hello: "Hello" } });

    createRegister("grid", { en: { pager: { next: "Next" } } })(i18n);

    // Through the instance's own resolver, not by reading the store back: what
    // a consumer needs is that `t("grid:pager.next")` works afterwards.
    expect(i18n.instance.t("grid:pager.next")).toBe("Next");
    // …and the app's own namespace is untouched beside it.
    expect(i18n.instance.t("common:hello")).toBe("Hello");
  });

  it("refuses to overwrite a key the app already declared", () => {
    /*
     * The load-bearing half of the flags. An app that overrode a package's
     * wording — the reason §13 has apps compose rather than packages
     * self-install — must win, so `register` passes `overwrite: false`. With
     * the flags transposed this assertion reads "Next" and the app's override
     * is silently gone.
     */
    const i18n = instanceWith({ grid: { pager: { next: "Onwards" } } });

    createRegister("grid", { en: { pager: { next: "Next" } } })(i18n);

    expect(i18n.instance.t("grid:pager.next")).toBe("Onwards");
  });

  it("writes into the instance, not into the app's catalogue object", () => {
    /*
     * The failure none of the cases above can see, because each builds its
     * catalogue inline. `ResourceStore` holds what `init` was handed by
     * reference and `addResourceBundle` writes into it — so before `D9.2`
     * copied the catalogues at init, registering into one instance wrote the
     * package's namespace into the caller's module-level object, and every
     * instance built from it afterwards inherited the registration.
     *
     * That is the cross-instance sharing ADR-0046 §13's factory rule exists to
     * prevent: `D7.1` put the instance inside a provider so a suite gets one
     * per render, and this leak would have handed the next render the previous
     * one's packages. `apps/admin` builds every instance from one
     * module-level `EN_RESOURCES`, so it is the exact shape at risk.
     */
    const catalogues = { common: { hello: "Hello" } };

    const first = instanceWith(catalogues);
    createRegister("grid", { en: { pager: { next: "Next" } } })(first);

    const second = instanceWith(catalogues);

    /*
     * The two together are the claim: one key, two instances, different
     * answers. `not.toBe` rather than an exact expected value because an
     * unresolved key comes back as the bare path (`pager.next`, prefix
     * stripped) rather than as what was asked for — a detail of i18next's
     * fallback that this test has no business pinning.
     */
    expect(second.instance.t("grid:pager.next")).not.toBe("Next");
    expect(first.instance.t("grid:pager.next")).toBe("Next");
  });

  it("merges deeply, so a package adds keys beside an app's override", () => {
    /*
     * The other half: `deep: true`. A shallow merge would replace the whole
     * `pager` object, so an app overriding one key would lose every sibling
     * the package shipped — the failure that looks like a missing translation
     * rather than like a merge bug.
     */
    const i18n = instanceWith({ grid: { pager: { next: "Onwards" } } });

    createRegister("grid", {
      en: { pager: { next: "Next", previous: "Previous" } },
    })(i18n);

    expect(i18n.instance.t("grid:pager.next")).toBe("Onwards");
    expect(i18n.instance.t("grid:pager.previous")).toBe("Previous");
  });
});
