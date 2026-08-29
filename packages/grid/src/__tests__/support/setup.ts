import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * The grid package's harness (`D9.4`, ADR-0036).
 *
 * jest-dom's matchers, and Testing Library's cleanup — which has to be
 * registered by hand because `@repo/vitest-config` leaves the test globals
 * off, so the automatic teardown never installs itself.
 *
 * **Nothing here mocks the network**, and that is the shape of what stayed:
 * the grid tests that needed MSW, the app's render harness or the demo
 * resource went back to `apps/admin/src/shared/grid/__tests__`, where those
 * things live. What is left in this package is what can be asked of the grid
 * with only React mounted.
 */
/*
 * What `@dnd-kit` needs from a DOM and jsdom does not have (`D10.3`).
 *
 * `DndContext` observes every droppable so it can re-measure on layout change;
 * jsdom implements no `ResizeObserver` at all, so without this the columns
 * menu throws on mount and takes every test that opens it with it. Radix wants
 * the pointer-capture trio for the same reason — `user-event` calls them on a
 * real pointer interaction.
 *
 * A stub rather than a polyfill: nothing here asserts a re-measurement, and a
 * working implementation would need a layout engine to observe.
 */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => undefined;
Element.prototype.releasePointerCapture ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;

afterEach(() => {
  cleanup();
});
