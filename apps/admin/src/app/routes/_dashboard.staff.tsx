import { createFileRoute } from "@tanstack/react-router";

import { StaffPage } from "@/pages/staff";

export const Route = createFileRoute("/_dashboard/staff")({
  component: StaffPage,
  staticData: { title: "Staff" },
});
