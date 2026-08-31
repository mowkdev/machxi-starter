/**
 * The one door `@repo/ui` comes through (ADR-0047 §What-code; ADR-0049 places
 * the file, ADR-0055 §2 gives this app its own).
 *
 * Every layer above `shared` imports design-system components from here, and a
 * lint rule refuses `@repo/ui/components/*` anywhere else. The point is that a
 * change on the other side of the boundary — a primitive renamed upstream, a
 * wrapper that gives one app defaults the other does not want — is one edit
 * here instead of a grep across every page.
 *
 * Re-exports only, and deliberately so: a component with app-specific
 * behaviour is not a re-export, it is a `shared/ui` component of its own, and
 * it goes in a file beside this one.
 *
 * Named rather than `export *` because the door is also the inventory: what
 * this app uses from the design system is readable in one screen, and adding to
 * it is a visible line in a diff. It is **one line long at `D12.1`** — the card
 * the login screen draws — which is the door doing its job rather than a stub:
 * this app's inventory is its own, not the admin's list minus what it has not
 * reached yet.
 */

export { Card } from "@repo/ui/components/card";
