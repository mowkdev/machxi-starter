import { createFileRoute } from "@tanstack/react-router";

import { UsersPage } from "@/pages/users";

export const Route = createFileRoute("/_dashboard/users")({
  component: UsersPage,
  staticData: { title: "Users" },
});
