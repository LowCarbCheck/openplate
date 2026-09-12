/**
 * settings.notifications.tsx: the one page that says what will arrive, and why
 * it cannot.
 *
 * Most push settings pages fail before permission is ever asked, because they
 * offer a switch the platform will refuse. This page states the reason FIRST.
 * The five availability states are ordered from most to least fundamental
 * (`pushAvailability` in `#app/lib/push` owns that order), and only the last
 * one draws a switch.
 *
 * ── The preview is the honest part ───────────────────────────────────────
 *
 * Before a person agrees to a daily notification they see tomorrow morning's
 * ACTUAL sentence, rendered by the same pure module the service worker will
 * read, so nobody agrees to a surprise. The lines arrive as a prop, so the
 * card renders in a test without a device store.
 *
 * The lines come from `buildCatchUp` in `#app/models/catch-up`, over the input
 * `loadCatchUpInput()` reads off this device, which is the same pair the
 * `/catch-up` page and the service worker's record use. There is no second
 * sentence written here: a preview that could disagree with the notification
 * would be worse than no preview at all.
 *
 * ── Nothing on this page is a form post ──────────────────────────────────
 *
 * Turning push on is a permission prompt, a `pushManager.subscribe` and a PUT,
 * none of which a route action can do: they are browser calls that only exist
 * in the tab. So the page drives `#app/lib/push` directly and reports through
 * the header status channel, and there is no `clientAction` here at all.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Route } from './+types/settings.notifications';

import { InstallAffordanceAction } from '#app/components/install-card';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { Switch } from '#app/components/ui/switch';
import { useInstallAffordance } from '#app/hooks/use-install-affordance';
import type { InstallAffordanceControls } from '#app/hooks/use-install-affordance';
import { useServerInstance } from '#app/hooks/use-server-instance';
import { loadCatchUpInput } from '#app/lib/catch-up-input';
import { buildCatchUp } from '#app/models/catch-up';
import { isIosDevice, isRunningStandalone } from '#app/lib/pwa-install';
import {
  DEFAULT_PUSH_PREFS,
  disablePush,
  enablePush,
  isPushDisabledByUser,
  pushAvailability,
  PushSetupError,
  readPushEnvironment,
  readPushPrefs,
  rememberedEndpoint,
  updatePushSchedule,
} from '#app/lib/push';
import type { PushAvailability, PushPrefs } from '#app/lib/push';
import { publishStatus } from '#app/lib/status';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
// The SAME formatter the fasting routine uses for a minute of the day, because
// this is also the `value` of an `<input type="time">`, which accepts exactly
// one format regardless of the reader's locale. A second spelling here would
// let the hub and this page disagree about what "08:00" means.
import { formatRoutineMinute } from './settings.fasting';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches`, never the i18next singleton.
export const meta: Route.MetaFunction = ({ matches }) => [
  { title: metaTitle(metaLanguage(matches), 'meta.notifications') },
];

export const handle = {
  title: 'Notifications',
  titleKey: 'settings.notifications.title',
  backTo: '/settings',
};

//////////////////////////////////////////////////////////////////////////////
// Constants
//////////////////////////////////////////////////////////////////////////////

/** Minutes in one hour, so the time field's arithmetic reads as arithmetic. */
const MINUTES_PER_HOUR = 60;

/** The shape a native `<input type="time">` submits: "08:00", always zero-padded, always 24 h. */
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/** One sentence per availability state, named once so the page and its test agree. */
export const AVAILABILITY_KEYS = {
  unsupported: 'settings.notifications.state.unsupported',
  'needs-install': 'settings.notifications.state.needsInstall',
  blocked: 'settings.notifications.state.blocked',
  'server-off': 'settings.notifications.state.serverOff',
  ready: 'settings.notifications.state.ready',
} satisfies Record<PushAvailability, string>;

/** The app's translator, narrowed to what this module asks of it. */
type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

//////////////////////////////////////////////////////////////////////////////
// Pure helpers (shared with the settings hub, which prints the same state)
//////////////////////////////////////////////////////////////////////////////

/**
 * The hub row's status line: what would arrive, in one phrase.
 *
 * Four answers and no fifth: off, the catch-up alone, the fast target alone,
 * or both. A device with push on and BOTH kinds unticked reads as off, which
 * is the truth about what will arrive.
 *
 * `null` while the device read is in flight, so the row never flashes a wrong
 * value, exactly as the fasting row does.
 *
 * @param facts - whether this device is registered, its two kinds, and the translator.
 * @returns the status line, or null while unknown.
 */
export function notificationsRowStatus({
  enabled,
  prefs,
  t,
}: {
  /** Whether this device holds a registration. `undefined` while the read is in flight. */
  enabled: boolean | undefined;
  prefs: PushPrefs;
  t: Translate;
}): string | null {
  if (enabled === undefined) return null;
  if (!enabled) return t('settings.hub.notifications.off');

  const catchUp = prefs.catchUpMinute;
  if (catchUp !== null && prefs.fastTargetEnabled) {
    return t('settings.hub.notifications.both', { time: formatRoutineMinute(catchUp) });
  }
  if (catchUp !== null) return t('settings.hub.notifications.catchUp', { time: formatRoutineMinute(catchUp) });
  if (prefs.fastTargetEnabled) return t('settings.hub.notifications.fastTarget');
  return t('settings.hub.notifications.off');
}

/**
 * A "HH:MM" from a native time input as minutes after local midnight, or
 * `null` when it is not a time at all.
 *
 * @param value - the field's value.
 * @returns the minute, or null.
 */
export function parseTimeInput(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (match === null) return null;
  const minute = Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
  return minute >= 0 && minute < 24 * MINUTES_PER_HOUR ? minute : null;
}

//////////////////////////////////////////////////////////////////////////////
// Loader
//////////////////////////////////////////////////////////////////////////////

/** No server work: everything on this page is a browser fact or a device preference. */
export async function loader() {
  return {};
}

//////////////////////////////////////////////////////////////////////////////
// Components
//////////////////////////////////////////////////////////////////////////////

/**
 * The one sentence a state gets, plus the install affordance for the iPhone
 * case.
 *
 * Presentational: it takes the state and the install controls as props rather
 * than reading either, so all five states render in one test without a phone.
 */
export function AvailabilityNotice({
  availability,
  install,
}: {
  availability: PushAvailability;
  /** The install hook's own return shape, or null on every state that has nothing to install. */
  install: InstallAffordanceControls | null;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t(AVAILABILITY_KEYS[availability])}</p>
      {availability === 'needs-install' && install !== null && (
        <InstallAffordanceAction affordance={install.affordance} promptInstall={install.promptInstall} />
      )}
    </div>
  );
}

/**
 * Tomorrow morning's actual text, or the line that says there is none yet.
 *
 * An EMPTY preview is never a fabricated sentence: a catch-up with nothing in
 * it is never sent (M223 spec 02), so a preview with nothing in it says so.
 */
export function CatchUpPreview({ previewLines }: { previewLines: readonly string[] }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border bg-muted/40 p-3">
      <p className="text-xs font-medium">{t('settings.notifications.catchUp.preview')}</p>
      {previewLines.length === 0 && (
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.notifications.catchUp.previewEmpty')}</p>
      )}
      {previewLines.map((line) => (
        <p key={line} className="mt-1 text-sm">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * The two kinds, the cap line and the save button. Rendered only once the
 * master switch is on, because every control here describes something that
 * would arrive.
 */
export function NotificationKinds({
  prefs,
  previewLines,
  isSaving,
  onChange,
  onSave,
}: {
  prefs: PushPrefs;
  previewLines: readonly string[];
  isSaving: boolean;
  onChange: (next: PushPrefs) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const catchUpMinute = prefs.catchUpMinute;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <input
            id="catch-up-enabled"
            type="checkbox"
            className="h-5 w-5 accent-primary"
            checked={catchUpMinute !== null}
            onChange={(event) =>
              onChange({
                ...prefs,
                catchUpMinute: event.target.checked ? DEFAULT_PUSH_PREFS.catchUpMinute : null,
              })
            }
          />
          <Label htmlFor="catch-up-enabled">{t('settings.notifications.catchUp.label')}</Label>
        </div>

        {catchUpMinute !== null && (
          <div className="space-y-3 pl-8">
            <div className="space-y-2">
              <Label htmlFor="catch-up-time">{t('settings.notifications.catchUp.time')}</Label>
              <Input
                id="catch-up-time"
                type="time"
                className="h-11 w-40 sm:h-9"
                value={formatRoutineMinute(catchUpMinute)}
                onChange={(event) => {
                  const minute = parseTimeInput(event.target.value);
                  if (minute === null) return;
                  onChange({ ...prefs, catchUpMinute: minute });
                }}
              />
            </div>
            <CatchUpPreview previewLines={previewLines} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <input
          id="fast-target-enabled"
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={prefs.fastTargetEnabled}
          onChange={(event) => onChange({ ...prefs, fastTargetEnabled: event.target.checked })}
        />
        <Label htmlFor="fast-target-enabled">{t('settings.notifications.fastTarget.label')}</Label>
      </div>

      <p className="text-xs text-muted-foreground">{t('settings.notifications.cap')}</p>

      <Button type="button" onClick={onSave} disabled={isSaving} className="h-11 sm:h-9">
        {t(isSaving ? 'settings.notifications.saving' : 'settings.notifications.save')}
      </Button>
    </div>
  );
}

//////////////////////////////////////////////////////////////////////////////
// The page
//////////////////////////////////////////////////////////////////////////////

export default function SettingsNotifications() {
  const { t, i18n } = useTranslation();
  const install = useInstallAffordance();
  const instance = useServerInstance();

  // `null` until the browser facts are readable: `isSecureContext`,
  // `PushManager` and the permission are all window reads, and a server render
  // has none of them. Rendering nothing beats rendering "unsupported" at a
  // person whose browser supports it perfectly well.
  const [availability, setAvailability] = useState<PushAvailability | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);
  const [isOn, setIsOn] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [previewLines, setPreviewLines] = useState<string[]>([]);

  const instancePush = instance?.push === true;

  useEffect(() => {
    const environment = readPushEnvironment({
      isIos: isIosDevice({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }),
      isStandalone: isRunningStandalone({
        displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
        // SAFETY: `navigator.standalone` is an iOS-only, non-standard property
        // missing from lib.dom's `Navigator`; the widened type only adds it as
        // optional, and `=== true` treats its absence as "not standalone".
        iosStandalone: (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
      }),
      instancePush,
    });
    setAvailability(pushAvailability(environment));
    setPrefs(readPushPrefs());
    setIsOn(rememberedEndpoint() !== null && !isPushDisabledByUser());
  }, [instancePush]);

  // Tomorrow morning's ACTUAL lines, off this device's last three days. A
  // separate effect because it is asynchronous and language-dependent, while
  // the reads above are synchronous browser facts.
  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      const input = await loadCatchUpInput({ t, locale: i18n.language });
      if (!isCancelled) setPreviewLines(buildCatchUp(input).lines);
    })();
    return () => {
      isCancelled = true;
    };
  }, [t, i18n.language]);

  const handleToggle = useCallback(
    async (next: boolean): Promise<void> => {
      setIsSaving(true);
      try {
        if (!next) {
          await disablePush();
          setIsOn(false);
          publishStatus({ text: t('settings.notifications.toast.off'), tone: 'success' });
          return;
        }
        await enablePush(prefs);
        setIsOn(true);
        publishStatus({ text: t('settings.notifications.toast.on'), tone: 'success' });
      } catch (caught) {
        // A refusal has a sentence of its own, and it is the SAME sentence the
        // state machine would have shown, so a person who denied the browser
        // prompt reads "blocked" rather than a generic failure.
        if (caught instanceof PushSetupError) {
          setAvailability(caught.reason);
          publishStatus({ text: t(AVAILABILITY_KEYS[caught.reason]), tone: 'error' });
          return;
        }
        publishStatus({ text: t('settings.notifications.toast.failed'), tone: 'error' });
      } finally {
        setIsSaving(false);
      }
    },
    [prefs, t],
  );

  const handleSave = useCallback(async (): Promise<void> => {
    setIsSaving(true);
    try {
      // A device that is already registered PATCHes; one that is not PUTs, so
      // saving is also the way a person who turned the switch on and then
      // changed a kind gets a row at all.
      if (isOn) await updatePushSchedule(prefs);
      else await enablePush(prefs);
      setIsOn(true);
      publishStatus({ text: t('settings.notifications.toast.saved'), tone: 'success' });
    } catch (caught) {
      if (caught instanceof PushSetupError) {
        setAvailability(caught.reason);
        publishStatus({ text: t(AVAILABILITY_KEYS[caught.reason]), tone: 'error' });
        return;
      }
      publishStatus({ text: t('settings.notifications.toast.failed'), tone: 'error' });
    } finally {
      setIsSaving(false);
    }
  }, [isOn, prefs, t]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.notifications.title')}</CardTitle>
          <CardDescription>{t('settings.notifications.lead')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {availability !== null && (
            <AvailabilityNotice availability={availability} install={availability === 'needs-install' ? install : null} />
          )}

          {availability === 'ready' && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="push-master">{t('settings.notifications.master')}</Label>
              <Switch
                id="push-master"
                checked={isOn}
                disabled={isSaving}
                onCheckedChange={(next) => void handleToggle(next)}
              />
            </div>
          )}

          {availability === 'ready' && isOn && (
            <NotificationKinds
              prefs={prefs}
              previewLines={previewLines}
              isSaving={isSaving}
              onChange={setPrefs}
              onSave={() => void handleSave()}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
