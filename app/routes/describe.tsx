/**
 * `/describe`, a message box for a meal, and nothing else.
 *
 * ── Why this screen exists ───────────────────────────────────────────────
 *
 * Typing already ran through the photo pipeline: the words reach `/scan`, the
 * AI works out the foods, and the plate path's review screen checks every one
 * of them before anything is saved. What was missing was a PLACE TO WRITE
 * THEM. The launcher's "Type" row opened `/add`, which is a database SEARCH
 * form with an AI button under the box, so somebody who wanted to say "2 fried
 * eggs and a slice of toast" was handed a search field and a list of foods. A
 * search box and a message box teach opposite things: one wants one noun, the
 * other wants a sentence.
 *
 * So this route is the composer, and only the composer. NO results, NO food
 * list, NO lookup of any kind runs here. The database search still exists, at
 * `/add`, and this screen links to it for the person who wants one exact item.
 *
 * ── Dictation is the KEYBOARD's, not this app's (M203) ────────────────────
 *
 * There was a microphone button here, wired to the browser's Web Speech API.
 * It is gone. Three reasons, and the first one is enough on its own:
 *
 * 1. It did not work where it was needed. Every failure of the recogniser was
 *    reported only to an `sr-only` live region, so on a phone a sighted person
 *    tapped a button and saw nothing happen at all.
 * 2. Web Speech is vendor infrastructure wearing a standard name: the audio
 *    goes to Google on Chrome and to Apple on Safari. That needs a consent
 *    dialog, and it is unreliable in an installed iOS web app.
 * 3. The phone keyboard's own dictation key does the same job with no code,
 *    no consent dialog of ours, and no dead button.
 *
 * `?speak=1` therefore still means something, and something honest: the field
 * takes focus and one line says which key to press. It is an ARMED TEXT
 * FIELD, never a recording.
 *
 * ── What it does NOT own ─────────────────────────────────────────────────
 *
 * The analysis, the review screen, the confirm, the diary write, the usage
 * accounting and the intake-source telemetry are all `/scan`'s, unchanged. All
 * this screen does is park the words in the one-shot hand-off slot
 * (`offerTypedText`) and navigate, which is exactly what `/add` has done since
 * 0.19.0. A second hand-off, or a second review screen, would be the beginning
 * of the fork that the one-pipeline rule exists to prevent.
 *
 * ── Client-only, no loader ───────────────────────────────────────────────
 *
 * There is nothing to load. The two inputs are `?date=` (which day the meal
 * belongs to, passed straight through to `/scan`) and `?speak=1` (focus the
 * field and show the dictation hint), and both are read off the URL in the
 * browser. Whether there is an AI to send the words to is `useAiIntake`'s
 * answer, the same one `/scan` and the camera gesture use: a BYOK row on an
 * open instance, the account's allowance on a managed one.
 */
import type { Route } from './+types/describe';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import { Send } from 'lucide-react';
import { Label } from '#app/components/ui/label';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { useAiIntake, type AiConnection, type AiIntakeDoor } from '#app/components/add/use-ai-connection';
import { NoAiIntakeNotice } from '#app/components/add/no-ai-intake-notice';
import { offerTypedText } from '#app/lib/scan-handoff';
import { RepeatYesterdayDoor } from '#app/components/repeat-yesterday-door';
import { selectRepeatYesterday } from '#app/lib/copy-day';
import type { RepeatYesterdayOffer } from '#app/lib/copy-day';
import { getLocalProfileGoals, listLocalFoodLogs, resolveLocalTimezone } from '#app/lib/local-store';
import { cn } from '#app/lib/utils';
import type { TypedIntakeSource } from '#app/lib/intake-source';
import { parseDateParam, shiftDate, todayInTimezone } from '#app/lib/user-days';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { useAppNavigate } from '#app/hooks/use-app-navigate';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.describe') }];

export const handle = {
  title: 'Describe your meal',
  titleKey: 'describe.title',
  backTo: '/diary',
};

/** Where the words go, carrying the day the person is looking at. */
export function describeScanHref(logDate: string | null): string {
  return logDate === null ? '/scan' : `/scan?date=${logDate}`;
}

/**
 * Parks the words and leaves for `/scan`.
 *
 * The navigation is injected rather than taken from `useNavigate`, so the
 * whole hand-off is callable from a test: the assertion there reads the REAL
 * slot back with `takeIntakeHandoff`, which is the only way to prove that what
 * `/scan` will pick up is the trimmed sentence and the right source.
 *
 * An empty box is not an error, it is a tap with nothing behind it: there is
 * nothing to park and a paid call about an empty string is worse than useless,
 * so it returns without spending anything.
 */
export function handOffDescription({
  text,
  source,
  scanHref,
  go,
}: {
  text: string;
  source: TypedIntakeSource;
  scanHref: string;
  go: (href: string) => void;
}): void {
  const trimmed = text.trim();
  if (trimmed === '') return;
  offerTypedText(trimmed, source);
  go(scanHref);
}

/**
 * Keeps the composer the height of what is in it, up to a ceiling.
 *
 * A one-line box for a three-line meal hides two thirds of what the person
 * wrote at the moment they are checking it. The ceiling is about six lines,
 * which stops a long paste from pushing the Send button off the screen; past
 * it the field scrolls.
 */
const COMPOSER_MAX_HEIGHT_PX = 168;

function growComposer(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  field.style.height = `${Math.min(field.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
}

interface DescribeComposerProps {
  /** What is in the box. Controlled, so one value drives the height and the Send state. */
  text: string;
  onTextChange: (text: string) => void;
  onSend: () => void;
  /** Whether this device has an AI to send the words to. `unknown` counts as no. */
  aiConnection: AiConnection;
  /**
   * Where a person with no AI is sent. A prop, like everything else here, so
   * the managed sentences can be rendered in a test at all.
   */
  door: AiIntakeDoor;
  /** `?speak=1`: focus the field and show the dictation hint. Nothing records. */
  speakArmed: boolean;
  /** The database search, for one exact item. */
  searchHref: string;
  /**
   * The "Wie gestern" offer (M217), or null for no door. Optional because the
   * route resolves it in an effect: the screen renders at once without it and
   * the door arrives a moment later, ABOVE the title where a late arrival
   * cannot move the Send button under a thumb.
   */
  repeatYesterday?: RepeatYesterdayOffer | null;
}

/**
 * The composer itself, presentational and prop-driven.
 *
 * IT IS ONE MESSAGE BOX, not a form. A bordered textarea, a square button
 * beside it and a full-width Send below it read as a form to fill in; a
 * person writing a sentence about lunch is writing a message. So one rounded
 * container carries the border and the focus ring, the textarea inside it is
 * borderless and transparent and grows with the content, and Send is a round
 * icon button in the container's bottom right corner.
 *
 * SPLIT FROM THE ROUTE ON PURPOSE. `renderToStaticMarkup` never runs an
 * effect, so a container that reads its provider through a hook could only ever
 * be rendered in one state, and "Send is disabled without a provider" would be
 * untestable in this repo (there is no DOM test library). Every branch that
 * decides what a person sees is a prop here.
 */
export function DescribeComposer({
  text,
  onTextChange,
  onSend,
  aiConnection,
  door,
  speakArmed,
  searchHref,
  repeatYesterday = null,
}: DescribeComposerProps) {
  const { t } = useTranslation();
  const hasAiProvider = aiConnection === 'connected';
  const canSend = hasAiProvider && text.trim() !== '';
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // The height follows the CONTENT, not the keystroke: dictated text arrives in
  // bursts, and a resize wired to `onChange` alone would leave three lines of a
  // pasted meal hidden behind one row.
  useEffect(() => {
    const field = fieldRef.current;
    if (field === null) return;
    growComposer(field);
  }, [text]);

  // Writing is the whole point of this screen, and reaching it is the
  // navigation the person just made, so the box takes focus once. `?speak=1`
  // wants exactly the same thing, because dictation types into a focused
  // field: there is no second control to hand focus to any more.
  const hasClaimedInitialFocus = useRef(false);
  useEffect(() => {
    if (hasClaimedInitialFocus.current) return;
    hasClaimedInitialFocus.current = true;
    fieldRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col gap-4">
      {/* ABOVE the title, and never between the title and the box. The
          composer is pinned to the bottom by `mt-auto`, so a door that arrives
          after the first paint pushes the heading down and leaves Send exactly
          where the thumb found it. */}
      <RepeatYesterdayDoor offer={repeatYesterday} />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{t('describe.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('describe.lead')}</p>
      </div>

      {/* The composer sits at the BOTTOM of the content area, where a message
          box belongs and where a thumb already is. */}
      <div className="mt-auto grid gap-2">
        {/* NO AI, so nothing here can work. Said before the box rather than
            after the tap, and the way out depends on WHY: an own provider to
            connect, a session to reopen, or an allowance only an administrator
            can raise. The search link below is the second way out either way,
            and it needs no AI at all. */}
        {aiConnection === 'absent' && (
          <NoAiIntakeNotice
            door={door}
            byokMessage={t('describe.needsProvider')}
            byokLinkLabel={t('describe.connect')}
            byokHref="/settings/ai?next=describe"
          />
        )}

        {/* The label is kept for the field, and hidden from sight: the
            placeholder already asks the question, and a visible label above a
            message box is the form look this screen is not. */}
        <Label htmlFor="describe-meal" className="sr-only">
          {t('describe.label')}
        </Label>

        {/* ONE CONTAINER. It owns the border, the background and the focus
            ring, so focusing the textarea lights the whole box rather than a
            rectangle inside a rectangle. */}
        <div className="flex items-end gap-2 rounded-2xl border border-input bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            id="describe-meal"
            ref={fieldRef}
            name="description"
            rows={1}
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            // ENTER SENDS, because this is a message box and that is what a
            // message box does. Shift and Enter still make a paragraph, for
            // the person who writes a meal a line at a time.
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              onSend();
            }}
            placeholder={t('describe.placeholder')}
            className="max-h-42 min-h-9 flex-1 resize-none border-0 bg-transparent py-1.5 text-base outline-hidden focus-visible:outline-hidden"
          />
          {/* Round, icon-only, inside the box, at the bottom so it stays
              beside the last line as the field grows. Disabled rather than
              hidden while it cannot be used: a button that appears as you type
              moves the layout under your thumb. */}
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            aria-label={t('describe.send')}
            className={cn(
              'mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden',
              canSend ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">{t('describe.sendHint')}</p>
        {/* Arrived from the "Speak" entry. The field is already focused; this
            names the key that turns speech into text, which is the keyboard's
            own and not this app's. */}
        {speakArmed && <p className="text-xs text-muted-foreground">{t('describe.dictateHint')}</p>}

        <Link to={searchHref} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          {t('describe.searchInstead')}
        </Link>
      </div>
    </div>
  );
}

export default function DescribeRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useAppNavigate();
  const [text, setText] = useState('');
  // `?speak=1` came from the launcher's "Speak" entry. It focuses the field and
  // shows the dictation hint; there is nothing to start and nothing to stop.
  const speakArmed = searchParams.get('speak') === '1';

  // The day the person is looking at, passed through untouched. `/scan`
  // normalizes a today-valued date against the device's own timezone, so
  // nothing here has to read the local store to do it a second time.
  const logDate = parseDateParam(searchParams.get('date'));
  const scanHref = describeScanHref(logDate);
  const searchHref = logDate === null ? '/add' : `/add?date=${logDate}`;

  const { connection: aiConnection, door } = useAiIntake();
  const hasAiProvider = aiConnection === 'connected';

  // NO LOADER, deliberately (see this file's header): a client loader on a
  // client-only route forces a HydrateFallback, which would blank the message
  // box on arrival, and the box taking focus at once is the whole point of this
  // screen. So the one thing worth reading from the store is read here, after
  // the first paint, and the door appears above the title when it lands.
  const [repeatYesterday, setRepeatYesterday] = useState<RepeatYesterdayOffer | null>(null);
  useEffect(() => {
    let isMounted = true;
    async function readOffer(): Promise<void> {
      const profile = await getLocalProfileGoals();
      const timezone = resolveLocalTimezone(profile);
      const today = todayInTimezone(timezone);
      const logs = await listLocalFoodLogs();
      if (!isMounted) return;
      setRepeatYesterday(selectRepeatYesterday({ logs, today, yesterday: shiftDate(today, -1) }));
    }
    void readOffer();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSend = useCallback((): void => {
    if (!hasAiProvider) return;
    handOffDescription({ text, source: 'text', scanHref, go: (href) => void navigate(href) });
  }, [hasAiProvider, navigate, scanHref, text]);

  return (
    <DescribeComposer
      text={text}
      onTextChange={setText}
      onSend={handleSend}
      aiConnection={aiConnection}
      door={door}
      speakArmed={speakArmed}
      searchHref={searchHref}
      repeatYesterday={repeatYesterday}
    />
  );
}
