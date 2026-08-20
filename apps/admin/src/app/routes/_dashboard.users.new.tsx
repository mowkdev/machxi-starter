import { createFileRoute } from "@tanstack/react-router";

import { userResourceConfig } from "@/entities/user";
import { CreateUserSurface } from "@/features/users-manage";
import { editSurfaceOf } from "@/shared/resource/config";

/**
 * `/users/new` — composing a record (ADR-0040).
 *
 * The staff mirror, and deliberately identical apart from the names: the
 * surface this renders in is `userResourceConfig`'s choice (a drawer), and
 * nothing in this file knows that. See `_dashboard.staff.new.tsx` for the
 * reasoning behind `fullHeight`.
 */
export const Route = createFileRoute("/_dashboard/users/new")({
  component: CreateUserSurface,
  staticData: {
    title: "New user",
    fullHeight: editSurfaceOf(userResourceConfig) !== "page",
  },
});
