import { createStaffBody } from "@repo/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { afterAll, describe, expect, it } from "vitest";

import { apiClientError } from "@/shared/api/api-error";
import {
  EN_RESOURCES,
  NAMESPACES,
  createI18n,
  type I18n,
  type TranslateKey,
} from "@/shared/i18n";
import { createMessageForError } from "@/shared/notifications/messages";
import { Button, Input } from "@/shared/ui";

import { AppFormProvider } from "../context";
import { applyServerErrors, schemaFieldRules } from "../server-errors";
import {
  applyZodLocale,
  createRuleTranslator,
  zodLocaleReady,
} from "../zod-locale";

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
 * **The form door's smoke test since `D22.3`** (ADR-0077 §4). The suite moved
 * into `@repo/form`, whose re-derivation and installer these are, and runs
 * there on the package's own instance. One case stays, because only this app
 * can show it: that the instance *this app* builds — its `createI18n`, which
 * binds `applyZodLocale` and `zodLocaleReady` — puts the rule in Latvian
 * through the door's re-exports. `turbo gen resource-screen` still fills this
 * file's `lv` block, which is why the block still spells every namespace out.
 */

interface Values {
  readonly password: string;
  readonly email: string;
}

const build = (): I18n =>
  createI18n({
    resources: {
      en: EN_RESOURCES,
      /*
       * **No `form` block since `D9.5`**: that namespace is `@repo/form`'s, so
       * this app's `Catalogue` no longer has a slot for it and the instance
       * gets it from the package instead — `en` composed at `init`, `lv`
       * through the package's own loader. Nothing here asserts on it; what the
       * Latvian cases below read is zod's generic locale map, which is
       * `@repo/contracts`'.
       */
      lv: {
        organizations: {},
        common: {},
        errors: {},
        auth: {},
        dashboard: {},
        profile: {},
        staff: {},
        users: {},
        settings: {},
        account: {},
      },
    },
    namespaces: NAMESPACES,
    locale: "en",
  });

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

  const messageForError = createMessageForError(
    i18n.instance.getFixedT(null, "errors"),
  );

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

describe("a refused field, re-derived through this app's instance", () => {
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
});
