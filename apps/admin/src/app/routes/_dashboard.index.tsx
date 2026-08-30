import { createFileRoute } from "@tanstack/react-router";

import { DashboardPage } from "@/pages/dashboard";

export const Route = createFileRoute("/_dashboard/")({
  component: DashboardPage,
  staticData: {
    title: "dashboard:title",
    // The band's second line since `D11.3` — it was a `CardDescription`
    // inside the page until the page card retired (ADR-0054 §5).
    description: "dashboard:description",
  },
});
