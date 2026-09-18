import type { AxiosInstance } from "axios";

import type { SessionStore } from "../session-store";
import type { ApiSegment } from "../transport";

/**
 * What every auth flow is handed (`D20.7`).
 *
 * The flows were closures inside `createApiClient` and are still closures —
 * one factory per group, closing over exactly this. Nothing new is available
 * to them and nothing they had is gone; the parameter object is the same
 * enclosing scope, written down.
 *
 * `publicBaseUrl` and `requireUserSegment` arrive from `client.ts` rather than
 * being rebuilt here, because both are derived from what the app handed the
 * factory and a second derivation is a second thing to keep in agreement.
 */
export interface FlowDeps {
  readonly instance: AxiosInstance;
  readonly store: SessionStore;
  /** This client's population, for the two flows that are pinned to one. */
  readonly segment: ApiSegment;
  /** Where the calls that have no population go (ADR-0015). */
  readonly publicBaseUrl: string;
  /** The guard the public calls that *write the store* share. */
  readonly requireUserSegment: (what: string) => void;
  /** The session's end, for the one flow that spends a link by ending it. */
  readonly endSession: () => void;
}
