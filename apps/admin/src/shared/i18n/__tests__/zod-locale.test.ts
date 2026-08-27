import {
  CUSTOM_MESSAGES,
  CUSTOM_MESSAGE_KEYS,
  changePasswordBody,
  passwordSchema,
} from "@repo/contracts";
import { afterAll, describe, expect, it } from "vitest";

import {
  EN_RESOURCES,
  NAMESPACES,
  RULE_KEYS,
  applyZodLocale,
  createI18n,
  createRuleTranslator,
  zodLocaleReady,
  type I18n,
  type TranslateKey,
} from "@/shared/i18n";
import enForm from "@/shared/i18n/locales/en/form.json";

/**
 * Validation copy under the active locale (`D7.5`, ADR-0046 §6, §14).
 *
 * The `lv` map itself is `@repo/contracts`' to test and is tested there, per
 * issue code. What only this side can prove is the *installation*: that
 * changing the language changes what a `@repo/contracts` schema says, without
 * any schema, form or component being handed a locale.
 *
 * `z.config` is process-global, so every case here restores `en` before it
 * finishes — the same discipline `intl.ts`'s holder needs, for the same reason,
 * and the reason ADR-0046 §5 named it rather than hid it.
 */

/** Not Latvian, and not claiming to be: `D7.6` writes the real catalogue. */
const LV_RULES = {
  rules: { passwordMustDiffer: "Jaunajai parolei jāatšķiras no pašreizējās" },
} as const;

const build = (lvForm: object = {}): I18n =>
  createI18n({
    resources: {
      en: EN_RESOURCES,
      lv: {
        common: {},
        form: lvForm,
        errors: {},
        auth: {},
        dashboard: {},
        profile: {},
        staff: {},
        users: {},
        settings: {},
      },
    },
    namespaces: NAMESPACES,
    locale: "en",
  });

const translator = (i18n: I18n) =>
  createRuleTranslator(i18n.instance.t as TranslateKey);

afterAll(async () => {
  applyZodLocale("en", translator(build()));
  await zodLocaleReady();
});

describe("the rule catalogue", () => {
  /**
   * The drift check the compiler cannot do. `Record<CustomMessageKey, …>`
   * proves `RULE_KEYS` names every key and `TranslationKey` proves each path
   * exists — neither can say the **sentences match**, and two catalogues of the
   * same rule that disagree is exactly the failure this key-per-rule design
   * introduced.
   */
  it("says the same thing as the source catalogue, key for key", () => {
    for (const key of CUSTOM_MESSAGE_KEYS) {
      expect(RULE_KEYS[key]).toBe(`form:rules.${key}`);
      expect(enForm.rules[key]).toBe(CUSTOM_MESSAGES[key]);
    }

    expect(Object.keys(enForm.rules)).toHaveLength(CUSTOM_MESSAGE_KEYS.length);
  });

  it("falls back to the source sentence for a key the catalogue lacks", () => {
    const i18n = build();

    expect(translator(i18n)("passwordMustDiffer")).toBe(
      CUSTOM_MESSAGES.passwordMustDiffer,
    );
  });
});

describe("the active zod locale", () => {
  it("says a generic rule in English until the language changes", () => {
    const parsed = passwordSchema.safeParse("short");

    expect(parsed.error?.issues[0]?.message).toBe(
      "Too small: expected string to have >=12 characters",
    );
  });

  it("moves a generic rule with the language, and moves it back", async () => {
    const i18n = build();

    await i18n.changeLocale("lv");

    expect(passwordSchema.safeParse("short").error?.issues[0]?.message).toBe(
      "Pārāk mazs: tekstam jāsatur >=12 rakstzīmju",
    );

    await i18n.changeLocale("en");

    expect(passwordSchema.safeParse("short").error?.issues[0]?.message).toBe(
      "Too small: expected string to have >=12 characters",
    );
  });

  /**
   * The half a locale map cannot reach. A `.refine()`'s sentence is nobody's
   * issue code, so it travels as a key and is answered from the `form`
   * namespace — which is why `@repo/contracts` stopped writing the sentence on
   * the refinement at all.
   */
  it("moves a keyed rule with the language", async () => {
    const i18n = build(LV_RULES);
    const same = {
      currentPassword: "same-password-12",
      newPassword: "same-password-12",
    };

    expect(changePasswordBody.safeParse(same).error?.issues[0]?.message).toBe(
      CUSTOM_MESSAGES.passwordMustDiffer,
    );

    await i18n.changeLocale("lv");

    expect(changePasswordBody.safeParse(same).error?.issues[0]?.message).toBe(
      LV_RULES.rules.passwordMustDiffer,
    );
  });

  /**
   * A partly-translated locale is the normal state of one, and it must degrade
   * to the source sentence rather than to a raw key — the same fallback
   * i18next performs for every other kind of copy.
   */
  it("keeps the source sentence for a keyed rule the locale has not translated", async () => {
    const i18n = build();

    await i18n.changeLocale("lv");

    expect(
      changePasswordBody.safeParse({
        currentPassword: "same-password-12",
        newPassword: "same-password-12",
      }).error?.issues[0]?.message,
    ).toBe(CUSTOM_MESSAGES.passwordMustDiffer);
  });

  it("settles what it installed, so a caller can wait for the switch", async () => {
    const i18n = build();

    applyZodLocale("lv", translator(i18n));
    await zodLocaleReady();

    expect(passwordSchema.safeParse("short").error?.issues[0]?.message).toBe(
      "Pārāk mazs: tekstam jāsatur >=12 rakstzīmju",
    );
  });
});
