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
 * `/add/search`, one tap away in the method switcher the `/add` layout draws
 * above this screen (M255/01), for the person who wants one exact item.
 *
 * ── The words outlive the screen ──────────────────────────────────────────
 *
 * What is in the box is a draft in `add-drafts.ts`, read when this screen
 * mounts and written as it changes, so a person who switches to Photo or
 * Search and comes back finds their sentence still there. Sending does not
 * clear it: the words go on to `/add/photo`, and if that analysis fails the
 * person comes back here to fix them. The photo screen clears it once the meal
 * those words describe is logged. The pantry's composer (`?to=/pantry`) keeps
 * no draft, because a list of what is on the shelf is not a meal.
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
import type { Route } from './+types/add.describe';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import { Label } from '#app/components/ui/label';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { useAiIntake, type AiConnection, type AiIntakeDoor } from '#app/components/add/use-ai-connection';
import { NoAiIntakeNotice } from '#app/components/add/no-ai-intake-notice';
import { buildIntakeHref } from '#app/lib/intake-hrefs';
import { readAddDraft, updateAddDraft } from '#app/lib/add-drafts';
import { offerTypedText } from '#app/lib/intake-handoff';
import { parseIntakeConsumer, type IntakeConsumer } from '#app/lib/intake-consumers';
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

/**
 * Parks the words and leaves for whoever asked for them.
 *
 * The destination is a parameter, not a constant: the diary sends these words
 * to `/scan` and the pantry sends them to `/pantry` (M233/01). Which one it is
 * was decided by the caller, against the allowlist in `intake-consumers.ts`,
 * so nothing here has to be told apart from an href.
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
  intakeHref,
  go,
}: {
  text: string;
  source: TypedIntakeSource;
  intakeHref: string;
  go: (href: string) => void;
}): void {
  const trimmed = text.trim();
  if (trimmed === '') return;
  offerTypedText(trimmed, source);
  go(intakeHref);
}

/**
 * The two invisible copies that size the field (M255/02): one of the
 * placeholder, one of what is typed. They share the field's grid cell, so the
 * cell is as tall as the taller of the two, and the field stretches to fill it.
 *
 * A FLOOR, AND THEN GROWTH. The empty box is as tall as its example meal, which
 * wraps on a phone: 84 px at 390 px in English. It used to size itself to its
 * content alone, so the first key hid the placeholder and the box dropped to
 * one line, and the whole composer moved under the thumb that typed it
 * (DESIGN.md section 7). With the placeholder's copy always in the cell, the
 * box never shrinks below its empty height, whatever the language, and it grows
 * once the words outgrow the example.
 *
 * THE CEILING is `max-h-42`, 168 px, about six lines, on the copies and on the
 * field alike, which stops a long paste from pushing Send off the screen; past
 * it the field scrolls.
 *
 * CSS, NOT A MEASUREMENT. The height is right on the first paint and at every
 * width, for a late font and a rotated phone alike, and dictated text that
 * arrives in bursts sizes the box the same way a key does, because the copy
 * follows the value and not the keystroke. Every class that decides where a
 * line breaks (the font size, the vertical padding, the wrapping) has to match
 * the field's, or the copy wraps where the field does not.
 */
const COMPOSER_SIZER_CLASS =
  'invisible col-start-1 row-start-1 max-h-42 overflow-hidden py-1.5 text-base break-words whitespace-pre-wrap';

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
  /**
   * WHO THE WORDS ARE FOR, and the one thing that changes this screen.
   *
   * The diary asks for a meal, the pantry asks for a shelf (M233/01), and the
   * two want different questions: "2 fried eggs and toast" is not a sentence
   * anybody writes about their fridge. It also decides which of the two doors
   * below belongs here at all, because it leads into the DIARY: the repeat of
   * yesterday copies a day of meals. Offering it to somebody stocking a pantry
   * is offering to do something else entirely. (The database search used to be
   * a second such door on this screen; it is the switcher's now, which the
   * `/add` layout leaves out for the pantry for the same reason.)
   */
  consumer: IntakeConsumer;
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
 * person writing a sentence about lunch is writing a message. So one
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
  consumer,
  repeatYesterday = null,
}: DescribeComposerProps) {
  const { t } = useTranslation();
  const hasAiProvider = aiConnection === 'connected';
  // The pantry's own question, and its own example. Two keys rather than a
  // conditional sentence, so each one is written for the screen it appears on
  // and translated as itself.
  const isForPantry = consumer === '/pantry';
  const title = isForPantry ? t('describe.pantry.title') : t('describe.title');
  const placeholder = isForPantry ? t('describe.pantry.placeholder') : t('describe.placeholder');
  const canSend = hasAiProvider && text.trim() !== '';
  const fieldRef = useRef<HTMLTextAreaElement>(null);

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
    /**
     * `min-h-full`, not a guessed fraction of the viewport.
     *
     * THE BOTTOM OF WHAT. `mt-auto` below pins the composer to the bottom of
     * THIS box, so where the composer lands is decided entirely by how tall
     * this box is. It used to be `min-h-[60vh]`, which is a fraction of the
     * WINDOW and has nothing to do with the room this route was actually
     * given: on a 390 x 844 phone the content pane is 735 px and 60vh is 506,
     * so the composer stopped 213 px short of the bottom and the rest of the
     * screen was bare background. The box was not at the top of the page and
     * not at the bottom of it either, which is what made the gap above it read
     * as a mistake rather than as a message box sitting where a thumb is.
     *
     * `min-h-full` resolves against the app shell's content pane
     * (`app-wrapper.tsx`), which already subtracts the header and already
     * reserves the bottom bar in its own padding. So the composer now ends
     * where the page ends, clear of the bar, on any screen — including the
     * short one a raised keyboard leaves, where 60vh was a guess in the other
     * direction.
     */
    <div data-slot="describe-page" className="mx-auto flex min-h-full max-w-2xl flex-col gap-4">
      {/* ABOVE the title, and never between the title and the box. The
          composer is pinned to the bottom by `mt-auto`, so a door that arrives
          after the first paint pushes the heading down and leaves Send exactly
          where the thumb found it. */}
      <RepeatYesterdayDoor offer={isForPantry ? null : repeatYesterday} />
      <div className="space-y-2">
        {/* AN h2, because the app chrome above already draws this route's
            `h1` from its handle. Two of them left the screen with no single
            name for assistive tech. */}
        <h2 className="text-xl font-semibold text-balance">{title}</h2>
        <p className="text-sm text-muted-foreground">{t('describe.lead')}</p>
      </div>

      {/* The composer sits at the BOTTOM of the content area, where a message
          box belongs and where a thumb already is. */}
      <div className="mt-auto grid gap-2">
        {/* NO AI, so nothing here can work. Said before the box rather than
            after the tap, and the way out depends on WHY: an own provider to
            connect, a session to reopen, or an allowance only an administrator
            can raise. Search in the switcher above is the second way out either
            way, and it needs no AI at all. */}
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
            rectangle inside a rectangle. Square corners, the same box the
            intake composer strip draws: a field and a key side by side. */}
        <div
          data-slot="describe-composer"
          className="flex items-end gap-2 border border-input bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring"
        >
          {/* THE FIELD AND ITS TWO SIZERS share one grid cell, so the field is
              never shorter than its placeholder and grows with its words
              (`COMPOSER_SIZER_CLASS`). */}
          <div data-slot="describe-field" className="grid min-w-0 flex-1">
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
              placeholder={placeholder}
              className="col-start-1 row-start-1 max-h-42 min-h-9 resize-none self-stretch border-0 bg-transparent py-1.5 text-base outline-hidden focus-visible:outline-hidden"
            />
            <span aria-hidden="true" className={COMPOSER_SIZER_CLASS}>
              {placeholder}
            </span>
            {/* The trailing space keeps a last empty line: a meal that ends in
                a new line is one line taller, and without it the copy is not. */}
            <span aria-hidden="true" className={COMPOSER_SIZER_CLASS}>
              {`${text} `}
            </span>
          </div>
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
              'mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden md:size-10',
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
      </div>
    </div>
  );
}

export default function DescribeRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useAppNavigate();
  // `?speak=1` came from the launcher's "Speak" entry. It focuses the field and
  // shows the dictation hint; there is nothing to start and nothing to stop.
  const speakArmed = searchParams.get('speak') === '1';

  // The day the person is looking at, passed through untouched. `/scan`
  // normalizes a today-valued date against the device's own timezone, so
  // nothing here has to read the local store to do it a second time.
  const logDate = parseDateParam(searchParams.get('date'));
  // Who the words go to. `?to=` is a NAME resolved against an allowlist, never
  // a path this screen navigates to as given, so the parameter cannot become an
  // open redirect; anything unknown resolves to `/scan`, which is where this
  // screen went before the pantry existed (`intake-consumers.ts`).
  const intakeConsumer = parseIntakeConsumer(searchParams.get('to'));
  // Where the words go, carrying the day the person is looking at.
  const intakeHref = buildIntakeHref(intakeConsumer, { date: logDate });

  // THE DRAFT, for a meal only (see this file's header). Read once, as the
  // box's first value, so the words are there on the first paint rather than
  // arriving a frame later and moving the composer.
  const keepsDraft = intakeConsumer !== '/pantry';
  const [text, setText] = useState(() => (keepsDraft ? (readAddDraft('describe')?.text ?? '') : ''));
  useEffect(() => {
    if (!keepsDraft) return;
    updateAddDraft('describe', { text });
  }, [keepsDraft, text]);

  const { connection: aiConnection, door } = useAiIntake();
  const hasAiProvider = aiConnection === 'connected';

  // NO LOADER, deliberately (see this file's header): a client loader on a
  // client-only route forces a HydrateFallback, which would blank the message
  // box on arrival, and the box taking focus at once is the whole point of this
  // screen. So the one thing worth reading from the store is read here, after
  // the first paint, and the door appears above the title when it lands.
  const [repeatYesterday, setRepeatYesterday] = useState<RepeatYesterdayOffer | null>(null);
  useEffect(() => {
    // NOT EVEN READ for the pantry: the door copies yesterday's MEALS into
    // today, which has nothing to do with a shelf, so the whole diary read is
    // skipped rather than resolved and then hidden.
    if (intakeConsumer === '/pantry') return;
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
  }, [intakeConsumer]);

  const handleSend = useCallback((): void => {
    if (!hasAiProvider) return;
    handOffDescription({ text, source: 'text', intakeHref, go: (href) => void navigate(href) });
  }, [hasAiProvider, intakeHref, navigate, text]);

  return (
    <DescribeComposer
      text={text}
      onTextChange={setText}
      onSend={handleSend}
      aiConnection={aiConnection}
      door={door}
      speakArmed={speakArmed}
      consumer={intakeConsumer}
      repeatYesterday={repeatYesterday}
    />
  );
}
