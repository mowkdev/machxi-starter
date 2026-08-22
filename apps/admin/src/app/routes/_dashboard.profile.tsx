import { createFileRoute } from "@tanstack/react-router";

import { ProfilePage } from "@/pages/profile";

export const Route = createFileRoute("/_dashboard/profile")({
  component: ProfilePage,
  staticData: { title: "profile:title" },
});
