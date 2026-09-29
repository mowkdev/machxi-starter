import { createI18n, usePseudoNotice } from "@repo/i18n";
import { useUiStrings } from "@repo/ui/ui-strings";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { AppRoot, type AppGate } from "../providers/app-root";

/**
 * The root's join (ADR-0077 §1): the order of the providers, asserted from
 * inside it.
 *
 * Neither app had a suite for `app/index.tsx` — `renderApp` rebuilds the tree
 * by hand, which is why a provider added to the root reaches no test unless it
 * is added there too. Now that the order is one component it can be read back:
 * each probe below is mounted where the router would be and reports what it
 * can reach.
 */

const i18n = () =>
  createI18n({
    resources: {
      en: {
        common: {
          ui: { close: "Close it" },
          loading: { starting: "Starting" },
        },
        errors: { fallback: "Something went wrong." },
      },
    },
    namespaces: ["common", "errors"],
    locale: "en",
    storageKeyPrefix: "kit.test",
  });

/** A settings gate's stand-in: it mounts the instance, as the apps' does. */
interface GateProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

const settingsOver = (
  instance: ReturnType<typeof i18n>["instance"],
): AppGate => {
  const Settings = ({ children }: GateProps) => (
    <I18nextProvider i18n={instance}>{children}</I18nextProvider>
  );

  return Settings;
};

const Open = ({ children }: GateProps) => <>{children}</>;

/** A gate that never opens: what the session is while the boot is in flight. */
const Holding = ({ fallback }: GateProps) => <>{fallback}</>;

const Probe = () => {
  const queryClient = useQueryClient();
  const strings = useUiStrings();
  const pseudo = usePseudoNotice();

  return (
    <dl>
      <dd data-testid="client">{String(queryClient instanceof QueryClient)}</dd>
      <dd data-testid="close">{strings.close}</dd>
      <dd data-testid="pseudo">{String(pseudo)}</dd>
    </dl>
  );
};

const renderRoot = ({
  session = Open,
  report,
  children = <Probe />,
}: {
  session?: AppGate;
  report?: (error: unknown) => void;
  children?: ReactNode;
} = {}) => {
  const errorMessages = { bind: vi.fn() };
  const outcomes = { bind: vi.fn() };

  render(
    <AppRoot
      errorMessages={errorMessages}
      outcomes={outcomes}
      pseudoNotice
      queryClient={new QueryClient()}
      report={report}
      session={session}
      settings={settingsOver(i18n().instance)}
      uiStringKeys={{ close: "common:ui.close" as never }}
    >
      {children}
    </AppRoot>,
  );

  return { errorMessages, outcomes };
};

describe("AppRoot", () => {
  it("puts the router under every provider it reads", () => {
    renderRoot();

    expect(screen.getByTestId("client")).toHaveTextContent("true");
    expect(screen.getByTestId("close")).toHaveTextContent("Close it");
    expect(screen.getByTestId("pseudo")).toHaveTextContent("true");
  });

  it("binds both deferred lookups from inside the instance", () => {
    const { errorMessages, outcomes } = renderRoot();

    expect(errorMessages.bind).toHaveBeenCalledTimes(1);
    expect(outcomes.bind).toHaveBeenCalledTimes(1);
  });

  it("renders nothing below a session gate that is still holding", () => {
    const { errorMessages } = renderRoot({ session: Holding });

    expect(screen.queryByTestId("client")).not.toBeInTheDocument();
    expect(errorMessages.bind).not.toHaveBeenCalled();
  });

  it("catches a throw from the router and reports it", () => {
    const report = vi.fn();
    const Thrower = (): ReactNode => {
      throw new Error("render exploded");
    };

    // React logs a caught render error; the boundary is what is under test.
    const silenced = vi.spyOn(console, "error").mockImplementation(() => {});

    renderRoot({ report, children: <Thrower /> });

    silenced.mockRestore();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong.",
    );
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      boundary: "app",
    });
  });
});
