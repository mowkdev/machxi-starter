import {
  isErrorCode,
  type FederatedIdentityResource,
  type UserProfileResource,
} from "@repo/contracts";
import { useRouterState } from "@tanstack/react-router";
import { KeyRoundIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useProfile, useStartGoogleLink } from "@/entities/profile";
import { useLocale, useT } from "@/shared/i18n";
import { useMessageForError } from "@/shared/notifications/messages";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
  QueryError,
  Separator,
  Skeleton,
} from "@/shared/ui";

import { safeAuthorizationUrl } from "../google-sign-in/continue-with-google";
import { GoogleMark } from "../google-sign-in/google-mark";
import { SetPasswordControl } from "./set-password-control";
import { UnlinkGoogleDialog } from "./unlink-google-dialog";

/**
 * One way in, as a row: what it is, whether the account has it, and the one
 * control that changes that. A labelled group, so a reader — and the suite —
 * can find a row by the name of the way in it is about.
 */
const MethodRow = ({
  icon,
  label,
  status,
  children,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly status: string;
  readonly children: ReactNode;
}) => {
  const id = useId();

  return (
    <div
      aria-labelledby={id}
      className="flex flex-wrap items-start justify-between gap-3"
      role="group"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-4 shrink-0 text-muted-foreground [&>svg]:size-4">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium" id={id}>
            {label}
          </p>
          <p className="text-sm break-words text-muted-foreground">{status}</p>
        </div>
      </div>
      <div className="flex max-w-full flex-col items-start gap-2">
        {children}
      </div>
    </div>
  );
};

/**
 * "Link Google" — the link start (ADR-0072 §3), "Continue with Google"'s
 * twin for an account already signed in: it posts the start, fences the
 * answer to an `https:` address and sends the browser there. The callback
 * comes back to `/auth/google#linked=google`, which lands on this section.
 */
const LinkGoogleButton = () => {
  const { t } = useT("profile");
  const { locale } = useLocale();
  const start = useStartGoogleLink();
  const messageForError = useMessageForError();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const onClick = async () => {
    setError(null);
    setLeaving(true);

    try {
      const { authorizationUrl } = await start.mutateAsync({ locale });

      window.open(safeAuthorizationUrl(authorizationUrl), "_self");
    } catch (failure) {
      setError(messageForError(failure));
      setLeaving(false);
    }
  };

  return (
    <>
      <Button
        aria-busy={leaving}
        disabled={leaving}
        onClick={() => void onClick()}
        type="button"
        variant="outline"
      >
        {t("methods.google.link")}
      </Button>
      {error === null ? null : <FieldError role="alert">{error}</FieldError>}
    </>
  );
};

/**
 * What the landing route carried here, as a notice (ADR-0072 §4, amended
 * after `D19.3`).
 *
 * **`identityLinked` is a hint, never a fact**: the fragment that produces it
 * can be planted, so the notice is drawn only when the identities the server
 * lists include the provider. **`identityLinkRefused`** is the code of a link
 * the callback refused, rendered as the catalogue's sentence — except the
 * generic `UNAUTHENTICATED`, whose catalogue sentence is about a session
 * having ended and which here means the attempt did not finish.
 */
const LinkNotice = ({
  identities,
}: {
  readonly identities: readonly FederatedIdentityResource[];
}) => {
  const { t } = useT("profile");
  const { t: tErrors } = useT("errors");
  const state = useRouterState({ select: (router) => router.location.state });
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
  };

  const refused = state.identityLinkRefused;

  if (refused !== undefined) {
    const code = refused.code;
    const message =
      code === "UNAUTHENTICATED"
        ? t("methods.notice.linkFailed")
        : isErrorCode(code)
          ? tErrors(code, { defaultValue: tErrors("fallback") })
          : tErrors("fallback");

    return (
      <Banner
        dismissible
        message={message}
        onDismiss={dismiss}
        variant="warning"
      />
    );
  }

  const linked = state.identityLinked;

  if (
    linked === undefined ||
    !identities.some((identity) => identity.provider === linked.provider)
  ) {
    return null;
  }

  return (
    <Banner
      dismissible
      message={t("methods.notice.linked")}
      onDismiss={dismiss}
      variant="info"
    />
  );
};

export interface SignInMethodsCardProps {
  /**
   * Whether this build offers linking Google (`VITE_FEATURE_GOOGLE_SIGN_IN`,
   * ADR-0072 §4) — the API's mount is still the control. Off, a linked
   * identity is still shown, and still unlinkable; only the link is absent.
   */
  readonly canLinkGoogle: boolean;
  /** Opens the change-password dialog, which the section owns. */
  readonly onChangePassword: () => void;
}

/**
 * **Sign-in methods** (ADR-0072 §3, §4) — the password and Google, each as a
 * row with the one control that fits the account as the server describes it.
 *
 * - The password row offers **Change password** when `hasPassword` is true
 *   and **Set a password** — the mailed link — when it is false; the
 *   change-password dialog is never opened for an account with no password,
 *   since it would ask for one that does not exist.
 * - The Google row offers **Link Google** when nothing is linked and
 *   **Unlink** when something is — unless the account has no password, when
 *   Google is its only way in and the row says so instead of offering a
 *   dialog the API would refuse `409 AUTH_LAST_CREDENTIAL`.
 *
 * Everything comes from `GET /user/profile` — `hasPassword` and `identities`
 * — read fresh, never from the session store.
 */
export const SignInMethodsCard = ({
  canLinkGoogle,
  onChangePassword,
}: SignInMethodsCardProps) => {
  const { t } = useT("profile");
  const profile = useProfile();
  const [unlinking, setUnlinking] = useState(false);

  return (
    <Card aria-labelledby="sign-in-methods-title" role="region">
      <CardHeader>
        <CardTitle id="sign-in-methods-title">{t("methods.title")}</CardTitle>
        <CardDescription>{t("methods.description")}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {profile.data === undefined && profile.error !== null ? (
          <QueryError
            error={profile.error}
            onRetry={() => {
              void profile.refetch();
            }}
          />
        ) : profile.data === undefined ? (
          <div aria-hidden className="flex flex-col gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <Methods
            canLinkGoogle={canLinkGoogle}
            onChangePassword={onChangePassword}
            onUnlink={() => {
              setUnlinking(true);
            }}
            profile={profile.data}
          />
        )}
      </CardContent>

      {unlinking ? (
        <UnlinkGoogleDialog
          onClose={() => {
            setUnlinking(false);
          }}
        />
      ) : null}
    </Card>
  );
};

const Methods = ({
  profile,
  canLinkGoogle,
  onChangePassword,
  onUnlink,
}: {
  readonly profile: UserProfileResource;
  readonly canLinkGoogle: boolean;
  readonly onChangePassword: () => void;
  readonly onUnlink: () => void;
}) => {
  const { t } = useT("profile");
  const google = profile.identities.find(
    (identity) => identity.provider === "google",
  );

  return (
    <>
      <LinkNotice identities={profile.identities} />

      <MethodRow
        icon={<KeyRoundIcon />}
        label={t("password.title")}
        status={
          profile.hasPassword
            ? t("methods.password.on")
            : t("methods.password.off")
        }
      >
        {profile.hasPassword ? (
          <Button onClick={onChangePassword} type="button" variant="outline">
            {t("password.action")}
          </Button>
        ) : (
          <SetPasswordControl email={profile.email} />
        )}
      </MethodRow>

      {profile.hasPassword ? (
        <p className="text-sm text-muted-foreground">{t("password.note")}</p>
      ) : null}

      {google === undefined && !canLinkGoogle ? null : (
        <>
          <Separator />
          <MethodRow
            icon={<GoogleMark />}
            label={t("methods.google.label")}
            status={
              google === undefined
                ? t("methods.google.off")
                : google.email === null
                  ? t("methods.google.on")
                  : t("methods.google.onAs", { email: google.email })
            }
          >
            {google === undefined ? (
              <LinkGoogleButton />
            ) : profile.hasPassword ? (
              <Button onClick={onUnlink} type="button" variant="outline">
                {t("methods.google.unlink")}
              </Button>
            ) : (
              <p className="max-w-64 text-sm text-muted-foreground">
                {t("methods.google.onlyWay")}
              </p>
            )}
          </MethodRow>
        </>
      )}
    </>
  );
};
