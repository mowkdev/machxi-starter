import { useT } from "@/shared/i18n";

/**
 * The signed-in landing screen.
 *
 * A page is thin composition, and at `D12.2` there is one thing to compose: the
 * heading, so the guard suites have something they can name and so a signed-in
 * customer lands on a screen rather than on a blank `Outlet`.
 *
 * **The `h1` is the page's own here, not the shell's**, because there is no
 * shell yet. `D12.5` mounts `AppShell`, whose page-header band owns the heading
 * and reads it off `staticData.title` (ADR-0054 §5) — the same key this renders
 * — so that step moves the element rather than the words, and `D12.5` is also
 * where the body ADR-0055 §5 asks for lands: a sentence stating what v1 is
 * instead of a dashboard pretending to be one.
 */
export const HomePage = () => {
  const { t } = useT("home");

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-[20px] leading-7 font-semibold tracking-tight">
        {t("title")}
      </h1>
    </div>
  );
};
