import {
  CUSTOM_MESSAGES,
  changePasswordBody,
  createStaffBody,
} from "@repo/contracts";
import { apiClientError } from "@repo/api-client";
import type { I18n, TranslateKey } from "@repo/i18n";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import type { ZodType } from "zod";
import { afterAll, describe, expect, it, vi } from "vitest";

import { AppFormProvider } from "../context";
import { applyServerErrors, schemaFieldRules } from "../server-errors";
import {
  applyZodLocale,
  createRuleTranslator,
  zodLocaleReady,
} from "../zod-locale";
import { createTestI18n, messageForError } from "./support/render";

/**
 * A field the API refused, read back in the operator's language (`D7.5`,
 * ADR-0046 §6).
 *
 * `D3.9` settled that a matched detail is rendered in the API's own words,
 * because those words are the contract's and the operator would have seen them
 * a moment earlier had the client caught the rule first. That argument survives
 * D7 intact and its conclusion does not: the API's words are English
 * (ADR-0013), and after this deliverable the operator's may not be. So the
 * schema is **re-run** rather than echoed — the same rule, caught a second
 * time, in the language the panel is in.
 *
 * The residual is asserted too, because it is the one shape this cannot
 * promise: a path the form's own values cannot produce an issue for keeps the
 * wire's sentence. That is the `D3.8` residual with one more property, not a
 * new one.
 *
 * **Moved here from the admin's door at `D22.3`** (ADR-0077 §4), with its
 * cases unchanged. `schemaFieldRules`, `applyServerErrors` and the zod locale
 * installer are this package's, so the instance is the package harness's —
 * built with the two seams an app binds — and the code map is its stand-in.
 * The admin keeps one case, the Latvian re-derivation through its own
 * instance, as the smoke test that its binding installs the same map.
 */

interface Values {
  readonly password: string;
  readonly email: string;
}

const build = (): I18n => createTestI18n();

afterAll(async () => {
  const i18n = build();

  applyZodLocale("en", createRuleTranslator(i18n.instance.t as TranslateKey));
  await zodLocaleReady();
});

/**
 * A form over a real contracts schema, so what it renders is what the operator
 * would have been shown by `zodResolver` for the same values.
 */
const Harness = ({ i18n }: { readonly i18n: I18n }) => {
  const form = useForm<Values>({
    defaultValues: { password: "short", email: "someone@example.test" },
  });

  return (
    <I18nextProvider i18n={i18n.instance}>
      <AppFormProvider fields={{}} variant="create" form={form}>
        <form aria-label="Harness">
          <Input aria-label="Password" {...form.register("password")} />
          <p data-slot="password-error">
            {form.formState.errors.password?.message}
          </p>
          <Button
            type="button"
            onClick={() => {
              applyServerErrors(
                apiClientError({
                  status: 400,
                  code: "VALIDATION_ERROR",
                  message: "Request validation failed",
                  details: [
                    {
                      path: "password",
                      message:
                        "Too small: expected string to have >=12 characters",
                    },
                  ],
                }),
                form.setError,
                {
                  fields: ["password", "email"],
                  messageForError,
                  rules: schemaFieldRules(createStaffBody, form.getValues()),
                },
              );
            }}
          >
            Fail
          </Button>
        </form>
      </AppFormProvider>
    </I18nextProvider>
  );
};

describe("schemaFieldRules", () => {
  it("answers a path its schema refuses and nothing else", () => {
    const rules = schemaFieldRules(changePasswordBody, {
      currentPassword: "same-password-12",
      newPassword: "same-password-12",
    });

    expect(rules("newPassword")).toBe(CUSTOM_MESSAGES.passwordMustDiffer);
    expect(rules("currentPassword")).toBeUndefined();
  });

  it("answers nothing at all for values its schema accepts", () => {
    const rules = schemaFieldRules(changePasswordBody, {
      currentPassword: "old-password-12",
      newPassword: "new-password-12",
    });

    expect(rules("newPassword")).toBeUndefined();
  });

  /**
   * A rejected submit that names three fields must not parse three times, and
   * one that names none must not parse at all — the whole reason the lookup is
   * built lazily rather than eagerly beside `messageForError`.
   */
  it("parses once however many paths it is asked about, and never if none", () => {
    const safeParse = vi.fn(() => createStaffBody.safeParse({}));
    const schema = { safeParse } as unknown as ZodType;

    const unused = schemaFieldRules(schema, {});

    expect(safeParse).not.toHaveBeenCalled();

    const rules = schemaFieldRules(schema, {});

    rules("email");
    rules("password");
    rules("firstName");

    expect(safeParse).toHaveBeenCalledTimes(1);
    expect(unused).toBeTypeOf("function");
  });

  it("keeps the first issue for a path, which is what the resolver shows", () => {
    const rules = schemaFieldRules(createStaffBody, {
      email: "not-an-address",
      password: "short",
      firstName: "",
      lastName: "",
      roles: [],
    });

    expect(rules("email")).toBe("Invalid email address");
  });

  /**
   * An async schema makes `safeParse` throw. Nothing in `@repo/contracts` has
   * one; the guard exists so that the day one arrives, the form falls back to
   * the API's sentence instead of crashing on a failed submit.
   */
  it("falls back to nothing when the schema refuses to parse synchronously", () => {
    const schema = {
      safeParse: () => {
        throw new Error("async schema");
      },
    } as unknown as ZodType;

    expect(schemaFieldRules(schema, {})("email")).toBeUndefined();
  });
});

describe("a refused field, re-derived", () => {
  it("shows the schema's rule rather than the wire's copy", async () => {
    const user = userEvent.setup();
    const i18n = build();

    render(<Harness i18n={i18n} />);
    await user.click(screen.getByRole("button", { name: "Fail" }));

    // Identical to the wire's sentence at `en`, which is the point: nothing
    // an operator sees changed, only where the sentence came from.
    expect(
      screen.getByText("Too small: expected string to have >=12 characters"),
    ).toBeInTheDocument();
  });

  it("says it in Latvian once the locale has moved, with no reload", async () => {
    const user = userEvent.setup();
    const i18n = build();

    render(<Harness i18n={i18n} />);
    await i18n.changeLocale("lv");
    await user.click(screen.getByRole("button", { name: "Fail" }));

    expect(
      screen.getByText("Pārāk mazs: tekstam jāsatur >=12 rakstzīmju"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Too small: expected string to have >=12 characters"),
    ).not.toBeInTheDocument();
  });

  /**
   * The residual, stated as a test so it cannot be mistaken for an oversight:
   * a detail whose path the form's own values produce no issue for keeps the
   * API's English. It is the `D3.8` case — a form whose state is not its body —
   * and it is still shown, which is the only guarantee that was ever made.
   */
  it("keeps the API's words for a rule the form's values cannot reproduce", () => {
    const rules = schemaFieldRules(createStaffBody, {
      email: "someone@example.test",
      password: "a-long-enough-password",
      firstName: "Ada",
      lastName: "Lovelace",
      roles: ["editor"],
    });

    expect(rules("email")).toBeUndefined();
  });
});
