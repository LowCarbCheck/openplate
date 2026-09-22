/**
 * The card a device with NO AI connection sees, lifted out of `/add/photo`
 * (M233/02; that screen was `/scan` before ADR-0019).
 *
 * ── Why it moved, and what did NOT change ────────────────────────────────
 *
 * `/pantry` runs the same provider call `/add/photo` does, through the same
 * rule (`useEffectiveAiSettings`), so it reaches the same dead end for the
 * same reasons: no BYOK row on an open instance, no allowance on a managed
 * one, or a session still resuming. A second card would be a second set of
 * sentences about one fact, and the two would drift the first time the
 * allowance rules moved. This is a PURE MOVE: not a class, not a word and not
 * a branch was changed on the way, and `/add/photo` re-exports every name it
 * used to export so the tests that render each shape still import them from
 * there.
 *
 * ── It talks about the camera, on both screens, on purpose ───────────────
 *
 * The copy names photo estimates, and that is right for the pantry too: the
 * thing a person cannot do without a connection is photograph a shelf. The one
 * sentence that is `/add/photo`-shaped is the "add without a photo" button,
 * which goes to the database search, and it is honest on `/pantry` as well,
 * since writing the list by hand is exactly what is still possible there.
 */
import { useEffect, useRef, useState } from 'react';
import { useRevalidator } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Camera } from 'lucide-react';

import { Link } from '#app/components/link';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { OAuthConnectButton } from '#app/components/oauth-connect-button';
import { InstancePresetConnect } from '#app/components/instance-preset-connect';
import { useSyncSession } from '#app/components/sync-status';
import { useInstanceInferencePreset, useInstancePolicy } from '#app/hooks/use-public-config';
import { useServerInstance } from '#app/hooks/use-server-instance';
import { resolveAllowanceDoor, type AllowanceDoor } from '#app/lib/ai/managed-ai-settings';
import { buildUrlWithoutSharedParam, hasSharedPhotoFlag, readSharedPhoto } from '#app/lib/shared-photo';
import { ADD_SEARCH_PATH } from '#app/lib/intake-hrefs';
import { supportsOauthPkce } from '#app/services/vision/registry';
import type { SyncSessionSnapshot } from '#app/lib/sync/sync-session';

/**
 * The one "not yet" state, shared by three waits: `/add/photo`'s client
 * loader reading the device, `/pantry`'s doing the same, and a managed
 * instance still reopening its session ({@link ConnectCard}). All three are
 * the same fact to the person in front of it, the answer has not arrived, and
 * a card that guessed at one of them would be wrong for a second.
 */
export function ScanLoading() {
  const { t } = useTranslation();
  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('scan.loading')}
    </output>
  );
}

/**
 * Reads back a photo shared into the app from the OS share sheet for a
 * visitor with no AI provider connected. `ScanFlow` (the normal reader of
 * this cache entry) never mounts for a keyless visitor, only `ConnectCard`
 * renders, so without this, the share silently had no visible effect at
 * all: no error, no acknowledgement, nothing. This still reads (and clears)
 * the cache entry so it can't linger forever, but keeps only an in-memory
 * preview to show what was received, a keyless visitor has no AI provider
 * connected yet, so nothing has been (or can be) identified or cached to the
 * on-device photo store, then `ConnectCard` says plainly what happened and
 * what to do.
 */
function useKeylessSharedPhotoPreview(): string | null {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    if (globalThis.window === undefined || !('caches' in window)) return;
    if (!hasSharedPhotoFlag(window.location.search)) return;
    handledRef.current = true;

    window.history.replaceState(null, '', buildUrlWithoutSharedParam(window.location.pathname, window.location.search));

    void (async () => {
      try {
        const sharedFile = await readSharedPhoto(window.caches);
        if (sharedFile) setPreviewUrl(URL.createObjectURL(sharedFile));
      } catch {
        // Nothing readable, ConnectCard just shows its normal copy.
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return previewUrl;
}

/**
 * Which of the connect cards this instance shows a user who has no AI
 * connection yet.
 *
 * - `self-hosted`: nobody but the provider the user picks themselves, so the
 *   BYOK buttons are the whole answer.
 * - `instance-ai`: this instance runs an inference endpoint of its own (M138
 *   spec 06), and the recipient is NAMED, a person deciding whether to press
 *   the shutter is deciding who sees the photo.
 * - `managed-missing`: a managed instance (M187 spec 03, M192), where AI comes
 *   from the account and never from a button on this card. It wins over a
 *   preset: a person here brings no key of their own, and the answer to a
 *   missing connection is their administrator rather than a provider signup.
 * - `resuming`: the same instance while the session is still being reopened.
 *   Not a card at all; `ConnectCard` renders the screen's loading placeholder,
 *   because a managed answer picked before the resume settles could be wrong
 *   for the moment the resume takes.
 *
 * ── The incident this rule exists for (0.10.3) ────────────────────────────
 *
 * A managed instance signed people out silently: a spent refresh token in the
 * device's cache was read by the service as theft and the whole family was
 * revoked. This screen then told them their account was not switched on for
 * photo estimates and to ask their administrator, of an account with a limit
 * of 200 that was never suspended and whose owner had done nothing. The rule
 * (`resolveEffectiveAiSettings`) was right to answer `null` regardless of
 * session; naming a cause is the SCREEN's job, and this is the screen.
 *
 * ── THE SIGNED-OUT CARD IS GONE (M204 spec 07) ────────────────────────────
 *
 * A fourth variant used to name a managed instance with no session, and sent
 * the person to the screen that reopens one. It cannot happen on this screen:
 * `_personal.tsx`'s gate reads `isDeviceLocked() || no session` and sends
 * every personal route, `/add/photo` included, to `/welcome` before this card
 * ever renders. The identical dead state was removed from `/add/describe` and
 * `/add/search` in M204 spec 01 (`resolveAiIntakeDoor`); this is the same
 * decision for the one screen it had not reached yet. See
 * `use-ai-connection.ts` for the full reasoning, which applies here unchanged.
 */
export type ConnectCardVariant =
  { kind: 'self-hosted' } | { kind: 'instance-ai'; host: string } | { kind: 'managed-missing' } | { kind: 'resuming' };

/** Whether this device holds a session, as this card has to ask it. */
export type ConnectSessionState = 'resuming' | 'signed-out' | 'signed-in';

/**
 * Reads the session snapshot as the three answers this card distinguishes.
 *
 * `account === null` alone is NOT "signed out": it is also every moment
 * between a reload and the end of the resume, which is why `isResuming` is
 * asked first (`SyncSessionSnapshot.isResuming`).
 */
export function resolveConnectSessionState(session: SyncSessionSnapshot): ConnectSessionState {
  if (session.isResuming) return 'resuming';
  return session.account === null ? 'signed-out' : 'signed-in';
}

export function resolveConnectCardVariant({
  managed,
  presetBaseUrl,
  sessionState,
}: {
  managed: boolean;
  presetBaseUrl: string | null;
  sessionState: ConnectSessionState;
}): ConnectCardVariant {
  if (managed) {
    // NOT SIGNED-IN VS SIGNED-OUT any more (M204 spec 07): the device lock
    // sends a signed-out device to `/welcome` before this ever renders, so
    // `resuming` is the only session shape left to distinguish.
    if (sessionState === 'resuming') return { kind: 'resuming' };
    return { kind: 'managed-missing' };
  }
  // An open instance's card does not depend on a session at all: the key is
  // the device's own, and there may be no account anywhere on this instance.
  if (presetBaseUrl === null) return { kind: 'self-hosted' };
  return { kind: 'instance-ai', host: new URL(presetBaseUrl).host };
}

/**
 * Keyless-friendly landing for a user without an AI provider yet, also the cold
 * open for anyone who's never scanned before, since /add/photo is a primary
 * tab. Says
 * plainly, before any jargon, what this does, that it needs a paid account the
 * visitor sets up themselves, roughly what it costs, and that everything else in
 * openplate works without it, so someone who will never do this can tell in one
 * screen and move on without feeling locked out (usability-overhaul fix). Replaces
 * the old hard redirect to /settings/ai with a warm connect card that also offers a
 * photo-free path to logging. When a photo was shared in from the OS share sheet
 * before an AI provider was connected, says so honestly instead of silently
 * dropping it (see `useKeylessSharedPhotoPreview`).
 *
 * On a MANAGED instance this card is a dead end by design, and says so: AI
 * comes from the account's own allowance, granted the moment the invite
 * creates it, so there is no button here that can fix a missing connection.
 * Exported for
 * `scan-connect-card.test.ts`, which renders both shapes.
 */
export function ConnectCard({ logDate }: { logDate: string | null }) {
  // Which instance this is decides the whole card. An instance that runs AI of
  // its own cannot say openplate runs none, because on this instance it does.
  // TWO ways an instance can: its own inference endpoint (M138 spec 06), or by
  // being a managed instance whose server proxies AI for its accounts (M192).
  const { aiComesFromTheInstance } = useInstancePolicy();
  const instancePreset = useInstanceInferencePreset();
  // AND WHETHER THIS DEVICE IS STILL RESUMING A SESSION, the one session
  // question a managed instance's card still asks (M204 spec 07). See
  // `resolveConnectCardVariant`.
  const session = useSyncSession();
  // AND WHY, when the answer is "this account has no allowance". Three
  // different facts wear that one variant, and only one of them is "ask your
  // administrator" (M212 spec 04). Resolved by the shared rule, so this card,
  // the composer's notice and the account page cannot disagree.
  const instance = useServerInstance();
  const allowanceDoor = resolveAllowanceDoor({
    memberInvites: instance?.memberInvites ?? false,
    allowanceExpiresAt: session.account?.allowanceExpiresAt ?? null,
    now: new Date(),
  });
  const variant = resolveConnectCardVariant({
    managed: aiComesFromTheInstance,
    presetBaseUrl: instancePreset?.baseUrl ?? null,
    sessionState: resolveConnectSessionState(session),
  });
  // NOT A CARD YET. The resume is still running and the two managed answers
  // are opposite, so the screen waits rather than picking one and correcting
  // itself a moment later.
  if (variant.kind === 'resuming') return <ScanLoading />;
  return <ConnectCardView variant={variant} logDate={logDate} allowanceDoor={allowanceDoor} />;
}

/**
 * The card itself, given its variant.
 *
 * SPLIT FROM THE HOOKS ABOVE so every shape can be rendered in a test. The
 * session snapshot is read through `useSyncExternalStore`, whose server
 * snapshot is a constant signed-out session, and on a managed instance that
 * now resolves to `managed-missing` regardless, the same shape a signed-in
 * device gets (M204 spec 07). `self-hosted` and `instance-ai` still need
 * `ConnectCardView` rendered directly, because those depend on the instance,
 * not the session.
 */
export function ConnectCardView({
  variant,
  logDate,
  allowanceDoor,
}: {
  variant: Exclude<ConnectCardVariant, { kind: 'resuming' }>;
  logDate: string | null;
  /**
   * Why the allowance is missing, read only by the `managed-missing` shape.
   *
   * REQUIRED, with no default. A default of `{ kind: 'ask-admin' }` would keep
   * the sentence that names an administrator on the one instance where there is
   * none, and it would compile, which is how a correctness argument reaches
   * zero call sites.
   */
  allowanceDoor: AllowanceDoor;
}) {
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const addHref = logDate ? `${ADD_SEARCH_PATH}?date=${logDate}` : ADD_SEARCH_PATH;
  const sharedPhotoPreviewUrl = useKeylessSharedPhotoPreview();
  // THE MANAGED SHAPE SUPPRESSES THE SAME BUTTONS the open shapes offer.
  // There is no key to bring on a managed instance, so the OAuth button, the
  // preset and the manual settings link are all wrong here.
  const isManaged = variant.kind === 'managed-missing';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5" /> {t('scan.setup.title')}
        </CardTitle>
        <CardDescription>
          {isManaged ? t('scan.setup.managed.description') : t('scan.setup.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Three shapes, because the honest answer differs. On a self-hosted
            instance there is nobody but the provider the user chooses, so one
            sentence covers it. On an instance with an AI endpoint of its own
            the photo goes to an endpoint this instance's operator runs, and
            the recipient is NAMED rather than left as "an AI", a person
            deciding whether to press the shutter is deciding who sees the
            photo. On a managed instance this card is a DEAD END by design: the
            connection arrives with an invite link, never from a button here,
            so the card explains the gap and points at the person who invited
            them. The recipient line is dropped in that case, because no photo
            goes anywhere yet. There is no fourth, signed-out shape any more
            (M204 spec 07): the device lock sends that visit to `/welcome`
            before this card renders. */}
        {variant.kind === 'self-hosted' && (
          <p className="text-sm text-muted-foreground">{t('scan.setup.crisp.selfHosted')}</p>
        )}
        {variant.kind === 'instance-ai' && (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t('scan.setup.crisp.managedWhat')}</p>
            <p>{t('scan.setup.crisp.managedWho', { host: variant.host })}</p>
          </div>
        )}
        {/* A DEAD END BY DESIGN, and it says so plainly: on a managed instance
            there is no key to bring and no provider to pick, so the only true
            answer is that photo estimates are not switched on for this account
            and the administrator is who switches them on. Every button that
            would suggest otherwise is suppressed below. */}
        {variant.kind === 'managed-missing' && (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t('scan.setup.managedMissing.body')}</p>
            {/* THE SECOND SENTENCE IS THE ONE THAT USED TO LIE. It named an
                administrator on every managed instance, and a consumer
                instance has none: there the truth is either a date that
                passed, or nothing more to say than the line above, which
                already says photo estimates are not switched on for this
                account. */}
            {allowanceDoor.kind === 'ask-admin' && <p>{t('scan.setup.managedMissing.askAdmin')}</p>}
            {allowanceDoor.kind === 'allowance-ended' && (
              <p>
                {t('scan.setup.managedMissing.expired', {
                  date: new Date(allowanceDoor.endedAt).toLocaleDateString(),
                })}
              </p>
            )}
          </div>
        )}
        {/* One tap, no key to go and get, renders nothing at all when this
            instance provides no AI of its own. Above the BYOK buttons because
            on such an instance it is the whole answer; `revalidate` re-runs
            `clientLoader`, which re-reads the device settings and swaps this
            card for the real scan flow. */}
        {/* Renders nothing when this instance provides no AI of its own, and
            is suppressed outright on a managed one: a preset button there would
            offer a second way in beside the account, which is not how the
            answer arrives. */}
        {!isManaged && <InstancePresetConnect onConnected={() => void revalidator.revalidate()} />}
        {sharedPhotoPreviewUrl && (
          <div className="flex items-center gap-3 border bg-muted/40 p-3">
            <img
              src={sharedPhotoPreviewUrl}
              alt={t('scan.setup.sharedPhotoAlt')}
              className="h-14 w-14 shrink-0 object-cover"
            />
            <p className="text-sm text-muted-foreground">{t('scan.setup.sharedPhotoNote')}</p>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          {/* Primary CTA: openrouter is the only provider with a one-click OAuth
              connect (`vision/registry.ts`), rendered off that capability,
              never a hardcoded provider check here. Absent on a managed
              instance: a user there never brings a key of their own, so
              offering one reads as "your OpenRouter connection is missing"
              when the real answer is a new invite link. */}
          {!isManaged && supportsOauthPkce('openrouter') && (
            <OAuthConnectButton className="h-11 w-full sm:flex-1">
              {t('scan.setup.connectOpenRouter')}
            </OAuthConnectButton>
          )}
          <Button asChild variant="outline" className="h-11 w-full sm:flex-1">
            <Link to={addHref}>{t('scan.capture.addWithoutPhoto')}</Link>
          </Button>
        </div>
        {!isManaged && (
          <div className="text-center">
            {/* `?next=scan` returns the user here once their key is connected.
                Dropped on a managed instance for the same reason as the OAuth
                button: there is no key for this user to set up by hand. */}
            <Link
              to="/settings/ai?next=scan"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t('scan.setup.manualSetup')}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
