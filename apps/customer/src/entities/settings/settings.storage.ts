import type {
  GridDensity,
  Theme,
  UpdateUserSettingsBody,
} from "@repo/contracts";

/**
 * The coalescing writer behind the account's display preferences (ADR-0045
 * §The server adapter, as carried by ADR-0053 §2).
 *
 * **It is the admin's writer with two thirds of it gone, and the subtraction is
 * this app's shape rather than a simplification.** That file exists to put an
 * account row behind ADR-0041's three-function preference seam: a mirror of
 * every grid's arrangement, the first-sync rule that adopts a device's local
 * cache exactly once, key↔`gridId` translation, and the `PreferenceStorage`
 * adapter the store reads through. ADR-0055 §3 keeps `@repo/grid` out of this
 * app until a domain entity arrives, so there is no store, no key to parse and
 * no arrangement to mirror — and a mirror with nothing in it would be a second
 * owner of nothing.
 *
 * What is left is what ADR-0045 decided about the *scalars*, unchanged: a
 * theme or a density change queues a value and schedules one coalesced `PATCH`,
 * the subscriber is installed rather than captured, and a failed write degrades
 * to "not persisting" rather than to a preference that springs back.
 *
 * The locale does not come through here, exactly as it does not in the admin
 * (ADR-0046 §4): it goes straight through `useUpdateSettings`, because a
 * language is chosen once and deliberately and there is nothing to coalesce.
 */

/**
 * One second, and it is a **coalescing** window rather than a delay.
 *
 * The admin's reason is a pointer drag on a column edge producing a write per
 * frame, which this app cannot do. The reason it is kept anyway is the
 * Preferences section itself: appearance and density are two cards a customer
 * setting the app up clicks in the same breath, and within the window they
 * collapse into one body carrying only the changed keys. Per-key merge
 * semantics on the server are what make sending only those keys safe (ADR-0045
 * §Endpoints).
 */
export const SETTINGS_WRITE_DEBOUNCE_MS = 1_000;

/** What a flush hands its subscriber: only the keys that changed. */
export type SettingsFlush = (body: UpdateUserSettingsBody) => void;

export interface SettingsWriterDeps {
  readonly delayMs?: number;
}

export const createSettingsWriter = ({
  delayMs = SETTINGS_WRITE_DEBOUNCE_MS,
}: SettingsWriterDeps = {}) => {
  /**
   * What the next flush will carry, and nothing else.
   *
   * Neither value is mirrored here. Their readers are the theme and density
   * providers, which adopt from the query's own answer, so a copy in this
   * closure would be a second owner of one fact with nobody reading it — and
   * the drift would be invisible. What the writer holds is only what it is
   * about to *send*.
   */
  let pendingTheme: Theme | null = null;
  let pendingGridDensity: GridDensity | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Where a flush goes, installed from an effect rather than at construction.
   *
   * The sender is `useUpdateSettings().mutateAsync`, which belongs to a
   * component and is therefore a render-time value; a writer that captured one
   * at construction would hold whichever it was given first. The observable
   * shape ADR-0033's session store established solves it the same way it
   * solves everything else here — the writer knows nothing about React, and
   * React subscribes to it.
   */
  let send: SettingsFlush | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    if (pendingTheme === null && pendingGridDensity === null) return;

    /*
     * No subscriber yet — keep the pending payload rather than dropping it.
     * `subscribe` flushes on arrival, so a write made in the gap between the
     * writer being built and the effect running still lands.
     */
    if (send === null) return;

    const sentTheme = pendingTheme;
    const sentDensity = pendingGridDensity;

    pendingTheme = null;
    pendingGridDensity = null;

    /*
     * Whatever happens next, the providers keep what they show: a failed write
     * degrades to "not persisting", never to a theme that reverts under
     * somebody who just chose it. They hear about it once, from the global
     * mutation handler's toast (ADR-0043) — coalesced with everything else in
     * this body.
     */
    send({
      ...(sentTheme === null ? {} : { theme: sentTheme }),
      ...(sentDensity === null ? {} : { gridDensity: sentDensity }),
    });
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);

    timer = setTimeout(flush, delayMs);
  };

  return {
    /**
     * Installs the sender, and flushes anything that was waiting for one.
     *
     * Returns the remover, so a provider's effect is a one-liner and a second
     * subscriber cannot silently replace the first.
     */
    subscribe: (next: SettingsFlush): (() => void) => {
      send = next;

      if (pendingTheme !== null || pendingGridDensity !== null) flush();

      return () => {
        if (send === next) send = null;
      };
    },

    /** Queues the theme half. The provider owns what is *displayed*. */
    setTheme: (next: Theme): void => {
      pendingTheme = next;
      schedule();
    },

    /** Queues the density half (ADR-0053 §2), the theme's twin down to the line. */
    setGridDensity: (next: GridDensity): void => {
      pendingGridDensity = next;
      schedule();
    },

    /** Sends whatever is pending now rather than at the end of the window. */
    flush,

    /**
     * A pending write when the tab closes is lost, and that is the "not
     * persisting" outcome accepted rather than fought with `sendBeacon`, which
     * cannot carry the bearer token (ADR-0045).
     */
    dispose: (): void => {
      if (timer !== null) clearTimeout(timer);

      timer = null;
    },
  } as const;
};

export type SettingsWriter = ReturnType<typeof createSettingsWriter>;
