import { Router } from "express";
import type { Population } from "@repo/contracts";

import { noStore, validate } from "../../core/middleware/index.js";
import type { SettingsController } from "./settings.controller.js";
import { updateSettingsSchemas } from "./settings.schemas.js";

/**
 * `/api/v1/{admin,user}/settings` (ADR-0015, ADR-0045).
 *
 * **One factory, called once per segment.** The resource is the same on both
 * and differs only in which body schema validates the patch, so the population
 * is a parameter rather than a second file — and the parameter is what will
 * carry the two apart the day their bodies stop being identical.
 *
 * There is no guard in this file and none at the mount either, which is the
 * decision rather than an omission: every handler reads its subject from
 * `ctx.principal`, there is no `:id` to compare, and so the ownership question
 * ADR-0019 §3 asks has no way to be answered wrongly. Every staff role,
 * `editor` included, may read and write its own settings; so may every
 * customer. That is word for word the reason both segment routers already give
 * for `/profile`.
 *
 * `no-store` covers the router, for the reason the routers beside it give
 * (ADR-0020): a response here is one operator's arrangement, and a shared
 * proxy that kept a page of it would hand the next caller somebody else's.
 * RFC 9111 already stops a shared cache storing a response to a request
 * carrying `Authorization`; this is the belt to those suspenders.
 */
export const createSettingsRouter = ({
  controller,
  population,
}: {
  readonly controller: SettingsController;
  readonly population: Population;
}): Router => {
  const router = Router();

  router.use(noStore);

  router.get("/", controller.get);
  router.patch(
    "/",
    validate(updateSettingsSchemas[population]),
    controller.update,
  );

  return router;
};
