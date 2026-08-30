"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The channel a page's own view controls travel to reach the page-header
 * band (ADR-0054 §5, `D11.12`).
 *
 * §5 puts the density control, the Columns control and the primary action
 * together in that band, right-aligned — and two of those three are built
 * deep inside `@repo/grid`, which renders *below* the band and cannot reach
 * it. `AppGrid` owns the table instance and the column preferences the
 * Columns menu reads, so hoisting the control means hoisting that state, and
 * hoisting that state means the grid's internals become the page's.
 *
 * **So the element travels, not the state.** The band publishes a DOM node;
 * a descendant renders into it through a portal, keeping its own React tree,
 * its context and its i18n exactly where they are. The dependency still
 * points one way — `@repo/grid` already depends on `@repo/ui`, and nothing
 * here makes the design system aware of a grid.
 *
 * **The alternative was passing an element up through state**, which is the
 * same thing with a render loop attached: the grid would `setState` on the
 * provider during its own render, and every column toggle would publish a
 * fresh element. A portal moves the pixels and leaves the ownership alone.
 */

const ContainerContext = createContext<HTMLElement | null>(null);

/**
 * Deliberately not part of the public door: only {@link PageActionsTarget}
 * registers, and it lives in this file beside the band that renders it.
 */
const RegisterContext = createContext<(node: HTMLElement | null) => void>(
  () => undefined,
);

export const PageActionsProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  return (
    <RegisterContext.Provider value={setContainer}>
      <ContainerContext.Provider value={container}>
        {children}
      </ContainerContext.Provider>
    </RegisterContext.Provider>
  );
};

/**
 * The band's own landing site, rendered by `AppShell` inside the page-actions
 * group and after whatever the app passed — which is what puts the app's
 * density control first and the grid's Columns and primary after it, in §5's
 * order.
 *
 * `display: contents` rather than a nested flex row: the portaled controls
 * have to be flex *items of the band*, sharing its `gap-2`, not children of a
 * box inside it that would space them separately and add a seam of its own.
 */
export const PageActionsTarget = () => {
  const register = useContext(RegisterContext);

  return (
    <div ref={register} data-slot="page-actions-target" className="contents" />
  );
};

/**
 * Whether a band is listening, which is the question a consumer asks before
 * deciding *where* to draw its controls.
 *
 * `null` is a real answer and not a failure: a grid rendered outside the
 * shell — a package test, a screen that is not a page — has no band to reach,
 * and draws its controls where it always did.
 */
export const usePageActionsContainer = (): HTMLElement | null =>
  useContext(ContainerContext);

/**
 * Renders `children` into the page-header band, or nowhere when no band is
 * listening. The `react-dom` import stays on this side of the door so a
 * consumer needs only the hook above and this component.
 */
export const PageActionsPortal = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const container = useContext(ContainerContext);

  return container === null ? null : createPortal(children, container);
};
