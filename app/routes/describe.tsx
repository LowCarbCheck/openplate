/**
 * `/describe`, a message box for a meal, and nothing else.
 *
 * ── Why this screen exists ───────────────────────────────────────────────
 *
 * Typing and speaking already ran through the photo pipeline: the words reach
 * `/scan`, the AI works out the foods, and the plate path's review screen
 * checks every one of them before anything is saved. What was missing was a
 * PLACE TO WRITE THEM. The launcher's "Type" row opened `/add`, which is a
 * database SEARCH form with an AI button under the box, so somebody who wanted
 * to say "2 fried eggs and a slice of toast" was handed a search field and a
 * list of foods. A search box and a message box teach opposite things: one
 * wants one noun, the other wants a sentence.
 *
 * So this route is the composer, and only the composer. NO results, NO food
 * list, NO lookup of any kind runs here. The database search still exists, at
 * `/add`, and this screen links to it for the person who wants one exact item.
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
 * belongs to, passed straight through to `/scan`) and `?speak=1` (arm the
 * microphone), and both are read off the URL in the browser. Whether there is
 * an AI to send the words to is `useAiIntake`'s answer, the same one `/scan`
 * and the camera gesture use: a BYOK row on an open instance, the account's
 * allowance on a managed one.
 */
import type { Route } from './+types/describe';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import { Send } from 'lucide-react';
import { Button } from '#app/components/ui/button';
import { Label } from '#app/components/ui/label';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { SpeechInputButton, useSpeechInputAvailable } from '#app/components/add/speech-input-button';
import { useAiIntake, type AiConnection, type AiIntakeDoor } from '#app/components/add/use-ai-connection';
import { NoAiIntakeNotice } from '#app/components/add/no-ai-intake-notice';
import { offerTypedText } from '#app/lib/scan-handoff';
import { resolveSpeechIntakeAction, type TypedIntakeSource } from '#app/lib/intake-source';
import { parseDateParam } from '#app/lib/user-days';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

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
 * A finished transcript, by the same pure rule `/add` follows.
 *
 * It lands in the composer either way, so nothing heard is ever lost. Whether
 * it ALSO goes straight to the AI is `resolveSpeechIntakeAction`'s call:
 * somebody who tapped the microphone meant to log, but there is nothing to
 * send when nothing was heard and nowhere to send it without a provider.
 */
export function applyDescribeTranscript({
  transcript,
  hasAiProvider,
  fill,
  send,
}: {
  transcript: string;
  hasAiProvider: boolean;
  fill: (text: string) => void;
  send: (text: string, source: TypedIntakeSource) => void;
}): void {
  fill(transcript);
  if (resolveSpeechIntakeAction({ transcript, hasAiProvider }) !== 'submit') return;
  send(transcript, 'speech');
}

/**
 * Keeps the composer the height of what is in it, up to a ceiling.
 *
 * A one-line box for a three-line meal hides two thirds of what the person
 * wrote at the moment they are checking it. The ceiling stops a long paste
 * from pushing the Send button off the screen; past it the field scrolls.
 */
const COMPOSER_MAX_HEIGHT_PX = 200;

function growComposer(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  field.style.height = `${Math.min(field.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
}

interface DescribeComposerProps {
  /** What is in the box. Controlled, so the transcript and the typing are one value. */
  text: string;
  onTextChange: (text: string) => void;
  onSend: () => void;
  /** A finished transcript, straight from the microphone button. */
  onTranscript: (transcript: string) => void;
  onNotice: (message: string) => void;
  /** Polite status text: what speech says back, and nothing else. */
  notice: string;
  /** Whether this device has an AI to send the words to. `unknown` counts as no. */
  aiConnection: AiConnection;
  /**
   * Where a person with no AI is sent. A prop, like everything else here, so
   * the managed sentences can be rendered in a test at all.
   */
  door: AiIntakeDoor;
  /** `null` while hydration has not answered yet; the microphone renders only on `true`. */
  speechAvailable: boolean | null;
  /** `?speak=1`: focus the microphone. It never starts a session by itself. */
  speakArmed: boolean;
  onListenStart: () => void;
  /** The database search, for one exact item. */
  searchHref: string;
}

/**
 * The composer itself, presentational and prop-driven.
 *
 * SPLIT FROM THE ROUTE ON PURPOSE. `renderToStaticMarkup` never runs an
 * effect, so a container that reads its provider and its recogniser through
 * hooks can only ever be rendered in one state, and "Send is disabled without
 * a provider" would be untestable in this repo (there is no DOM test library).
 * Every branch that decides what a person sees is a prop here.
 */
export function DescribeComposer({
  text,
  onTextChange,
  onSend,
  onTranscript,
  onNotice,
  notice,
  aiConnection,
  door,
  speechAvailable,
  speakArmed,
  onListenStart,
  searchHref,
}: DescribeComposerProps) {
  const { t } = useTranslation();
  const hasAiProvider = aiConnection === 'connected';
  const canSend = hasAiProvider && text.trim() !== '';
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // The height follows the CONTENT, not the keystroke: a dictated meal arrives
  // as one assignment from outside this component, and a resize wired to
  // `onChange` alone would leave three lines of it hidden behind two rows.
  useEffect(() => {
    const field = fieldRef.current;
    if (field === null) return;
    growComposer(field);
  }, [text]);

  // Writing is the whole point of this screen, and reaching it is the
  // navigation the person just made, so the box takes focus once. The one
  // exception is the armed microphone, which claims focus itself: waiting for
  // the availability answer before deciding is what stops the two from
  // fighting over it (the same rule `/add` follows).
  const hasClaimedInitialFocus = useRef(false);
  useEffect(() => {
    if (hasClaimedInitialFocus.current) return;
    if (speechAvailable === null) return;
    hasClaimedInitialFocus.current = true;
    if (speakArmed && speechAvailable) return;
    fieldRef.current?.focus();
  }, [speakArmed, speechAvailable]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col gap-4">
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

        <Label htmlFor="describe-meal">{t('describe.label')}</Label>
        <div className="flex items-end gap-2">
          <textarea
            id="describe-meal"
            ref={fieldRef}
            name="description"
            rows={2}
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
            className="min-h-11 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          />
          {speechAvailable === true && (
            <SpeechInputButton
              armed={speakArmed}
              onTranscript={onTranscript}
              onNotice={onNotice}
              onListenStart={onListenStart}
            />
          )}
        </div>

        {/* Disabled rather than hidden while the box is empty: a button that
            appears as you type moves the layout under your thumb. */}
        <Button type="button" onClick={onSend} disabled={!canSend} className="h-11 w-full">
          <Send className="h-4 w-4" aria-hidden="true" /> {t('describe.send')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('describe.sendHint')}</p>
        {speakArmed && speechAvailable === true && (
          <p className="text-xs text-muted-foreground">{t('describe.speakHint')}</p>
        )}

        <Link to={searchHref} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          {t('describe.searchInstead')}
        </Link>

        {/* One polite region for everything speech says back. `sr-only`
            because the transcript itself is already in the box for anyone who
            is looking at it. */}
        <output aria-live="polite" className="sr-only">
          {notice}
        </output>
      </div>
    </div>
  );
}

export default function DescribeRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  // `?speak=1` arms the microphone ONCE. It is dropped the moment a session
  // actually starts, so the hint does not sit under a live microphone.
  const [speakArmed, setSpeakArmed] = useState(searchParams.get('speak') === '1');

  // The day the person is looking at, passed through untouched. `/scan`
  // normalizes a today-valued date against the device's own timezone, so
  // nothing here has to read the local store to do it a second time.
  const logDate = parseDateParam(searchParams.get('date'));
  const scanHref = describeScanHref(logDate);
  const searchHref = logDate === null ? '/add' : `/add?date=${logDate}`;

  const { connection: aiConnection, door } = useAiIntake();
  const speechAvailable = useSpeechInputAvailable();
  const hasAiProvider = aiConnection === 'connected';

  const send = useCallback(
    (value: string, source: TypedIntakeSource): void => {
      handOffDescription({ text: value, source, scanHref, go: (href) => void navigate(href) });
    },
    [navigate, scanHref],
  );

  const handleSend = useCallback((): void => {
    if (!hasAiProvider) return;
    send(text, 'text');
  }, [hasAiProvider, send, text]);

  const handleTranscript = useCallback(
    (transcript: string): void => {
      applyDescribeTranscript({ transcript, hasAiProvider, fill: setText, send });
    },
    [hasAiProvider, send],
  );

  const handleListenStart = useCallback((): void => {
    setSpeakArmed(false);
  }, []);

  return (
    <DescribeComposer
      text={text}
      onTextChange={setText}
      onSend={handleSend}
      onTranscript={handleTranscript}
      onNotice={setNotice}
      notice={notice}
      aiConnection={aiConnection}
      door={door}
      speechAvailable={speechAvailable}
      speakArmed={speakArmed}
      onListenStart={handleListenStart}
      searchHref={searchHref}
    />
  );
}
