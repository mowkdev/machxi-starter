import { reactConfig } from "@repo/vitest-config/react";
import { defineConfig, mergeConfig } from "vitest/config";

/**
 * The tail's suite (`D9.6`, ADR-0036).
 *
 * `reactConfig` because everything here touches the browser: the theme reads
 * `localStorage` and `matchMedia`, the auth hooks read the session store, and
 * `route-meta` reads the router's matches.
 *
 * **Its suite is deliberately small.** Every case about `apps/admin`'s own
 * data stayed in that app and now drives this code through the doors — the
 * policy transcription, the narrowing over that app's resources, the theme
 * control, the shells that read a route's `staticData`. What is here is the
 * part that had no suite of its own until the split made it separable: the
 * rule underneath the policy table, asked over a vocabulary no app in this
 * repo uses.
 */
export default mergeConfig(reactConfig, defineConfig({}));
