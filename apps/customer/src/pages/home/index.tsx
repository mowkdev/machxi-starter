import { useActiveOrganization } from "@/entities/organization";
import { useT } from "@/shared/i18n";
import { AppNotFound, Card, CardContent, Skeleton } from "@/shared/ui";

/**
 * The signed-in landing screen — **the first screen that exists at two
 * addresses** (`D15.9`, ADR-0067 §6 as amended 2026-09-07).
 *
 * `/` mounts it acting as the caller's personal organization and
 * `/orgs/$orgSlug` mounts it acting as that team, and this page does not know
 * which of the two did: it asks `useActiveOrganization` what context it is in
 * and draws it. That is the property the amendment is really about — a tenant
 * screen's context is its URL (ADR-0067 §4), so "two addresses, one page" costs
 * a hook rather than a duplicated route subtree, and every screen this app grows
 * later inherits it by reading the same resolver.
 *
 * **The `h1` left at `D12.5`**: the shell's page-header band owns the heading and
 * reads it off `staticData.title` (ADR-0054 §5), so the element moved and the
 * words did not.
 *
 * **What it says is the decision, not the markup.** ADR-0055 §5 asks for a home
 * that states what v1 is rather than a dashboard pretending to be one: this app
 * ships self-service, no customer-ownable domain entity exists yet, and a screen
 * of empty stat tiles would be a promise the API cannot keep. What `D15.9` adds
 * is the one fact that is now genuinely per-context — which organization you are
 * acting as — because a screen that looked identical in every context would make
 * the switcher's effect invisible, which is the defect the amendment exists to
 * fix.
 *
 * A document page, so the card stays: ADR-0054 §5 retires the *page card* on
 * band layouts, and this is not one. It carries §3's 20px card padding over the
 * primitive's 24 through `className`, exactly as the sign-in card does, so
 * `packages/ui/src/components/` stays byte-identical (ADR-0047).
 */
export const HomePage = () => {
  const { t } = useT("home");
  const { isError, organization, state } = useActiveOrganization();

  /*
   * An address naming nothing this account can see — an unknown slug, or the
   * personal organization's derived one, which is not addressed at all
   * (ADR-0067 §6). Rendered rather than thrown, the `D15.5` finding: a
   * `notFound()` thrown from a component escapes every route boundary.
   */
  if (state === "missing") return <AppNotFound />;

  if (organization === undefined)
    return isError ? (
      <Card className="p-5">
        <p className="text-[14px] leading-5 text-muted-foreground">
          {t("context.error")}
        </p>
      </Card>
    ) : (
      <Skeleton aria-hidden className="h-24 w-full" />
    );

  return (
    <Card className="p-5">
      <CardContent className="flex flex-col gap-3 p-0">
        {/*
         * The context, named. `kind` rather than the slug's presence, so the
         * private context reads as the word the switcher uses for it rather
         * than as an organization whose name happens to be the account holder's
         * — ADR-0067 §6 makes a personal organization's name unmanaged.
         */}
        <p className="text-[14px] font-medium leading-5">
          {organization.kind === "personal"
            ? t("context.private")
            : t("context.team", { name: organization.name })}
        </p>
        <p className="text-[14px] leading-5 text-muted-foreground">
          {t("body")}
        </p>
      </CardContent>
    </Card>
  );
};
