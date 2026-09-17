import type { Db, DbExecutor } from "@repo/db";

import { createSettingsController } from "./settings.controller.js";
import { createSettingsRepository } from "./settings.repository.js";
import { createSettingsService } from "./settings.service.js";

/** What the composition root hands this module (ADR-0073 §10). */
export interface WireSettingsDeps {
  /**
   * The client rather than an executor, because this module's repository uses
   * it as the default executor of every read (`tx = db`).
   */
  readonly db: Db;
  /** Runs `fn` inside one database transaction (ADR-0006). */
  readonly transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
}

/**
 * The settings module's wiring (ADR-0073 §10).
 *
 * One service for both segments and both tables (ADR-0045). It takes no
 * hasher and no session dependency: a settings row holds display state and
 * nothing a credential or a session could be reached through.
 *
 * **One** controller for both segments as well: neither of its handlers takes
 * an id, so there is nothing a second factory would withhold from the other
 * mount.
 */
export const wireSettings = ({ db, transaction }: WireSettingsDeps) => {
  const repository = createSettingsRepository(db);
  const settings = createSettingsService({ repository, transaction });

  return {
    repositories: { settings: repository } as const,
    services: { settings } as const,
    controllers: { settings: createSettingsController(settings) } as const,
  } as const;
};
