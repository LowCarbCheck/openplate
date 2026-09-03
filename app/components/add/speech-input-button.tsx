/**
 * The microphone button beside the add screen's search field, plus the
 * one-time disclosure that gates it.
 *
 * WHAT THIS IS. A way to TYPE, not a way to log. Speech fills the search box
 * and nothing else: no entry is ever created from a spoken sentence, so a
 * misheard word costs one glance at the field, never a wrong meal in the diary.
 *
 * THE DISCLOSURE IS THE POINT. `Web Speech` sends the recording to the
 * BROWSER'S maker — Google on Chrome, Apple on Safari — not to openplate and
 * not to the AI provider the person chose in settings. Someone who picked a
 * local model for plate photos would reasonably assume their voice stays local
 * too. So the first tap opens the dialog, and only a deliberate "Continue"
 * both remembers the consent and starts listening, inside that same gesture
 * (which is also what the microphone permission needs).
 *
 * NO AUTO-START, EVER. `/add?speak=1` — the launcher's "Speak" entry — arms
 * this button and gives it focus. The person still presses it. An app that
 * opens a microphone on navigation is an app nobody can trust with one.
 *
 * The button renders only after hydration confirms a recogniser exists, so a
 * Firefox user (no implementation) and a server render both see the plain
 * search field, not a dead control.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Square } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#app/components/ui/alert-dialog';
import { cn } from '#app/lib/utils';
import {
  hasGivenSpeechConsent,
  isSpeechInputAvailable,
  rememberSpeechConsent,
  resolveSpeakAction,
  speechLanguageTag,
  startListening,
  type SpeechInputError,
  type SpeechInputSession,
} from '#app/lib/speech-input';

/**
 * Whether this browser can turn speech into text, resolved after hydration.
 *
 * `null` until the effect runs — the deliberate third state. Rendering the
 * button off a server-side `false` and then adding it on hydration would be a
 * markup mismatch; rendering it off an optimistic `true` would flash a control
 * Firefox can never honour. Callers wait for the boolean.
 */
export function useSpeechInputAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    setAvailable(isSpeechInputAvailable());
  }, []);
  return available;
}

/** The i18n key for each error the wrapper reports. A lookup, so a new error variant is a compile error here rather than a silent fallthrough. */
const ERROR_MESSAGE_KEYS = {
  'permission-denied': 'add.speak.error.permission',
  'no-speech': 'add.speak.error.noSpeech',
  failed: 'add.speak.error.failed',
} satisfies Record<SpeechInputError, string>;

interface SpeechInputButtonProps {
  /** Highlight the button and take focus on mount — set by `/add?speak=1`. Never starts a session. */
  armed: boolean;
  /** Receives the final transcript. The caller puts it in the field, moves focus there and runs the search. */
  onTranscript: (transcript: string) => void;
  /** Polite status text for the page's live region; called with `''` to clear it. */
  onNotice: (message: string) => void;
  /** Called when a session actually starts, so the caller can drop the "Tap to speak" hint. */
  onListenStart: () => void;
}

export function SpeechInputButton({ armed, onTranscript, onNotice, onListenStart }: SpeechInputButtonProps) {
  const { t, i18n } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sessionRef = useRef<SpeechInputSession | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [consented, setConsented] = useState(false);
  const [isAsking, setIsAsking] = useState(false);

  // Consent is a `localStorage` read, so it happens after mount like every
  // other browser-only read in this app — never during render.
  useEffect(() => {
    setConsented(hasGivenSpeechConsent());
  }, []);

  // The armed entry point: focus, no microphone. Runs on mount only, because
  // the button mounts exactly when availability resolves to true.
  useEffect(() => {
    if (!armed) return;
    buttonRef.current?.focus();
  }, [armed]);

  // A session that outlives its button would keep the microphone open on a
  // screen the person already left. `cancel` (not `stop`) so nothing lands in
  // a field that is gone.
  useEffect(
    () => () => {
      sessionRef.current?.cancel();
      sessionRef.current = null;
    },
    [],
  );

  const beginListening = useCallback((): void => {
    onNotice('');
    onListenStart();
    const settle = (): void => {
      sessionRef.current = null;
      setIsListening(false);
    };
    try {
      sessionRef.current = startListening({
        language: speechLanguageTag(i18n.language),
        onResult: onTranscript,
        onError: (error) => {
          settle();
          onNotice(t(ERROR_MESSAGE_KEYS[error]));
          // Focus goes back to the control that failed, not to the field: the
          // next thing to do is tap again, and a screen reader lands on the
          // button that says so.
          buttonRef.current?.focus();
        },
        onEnd: ({ heardSomething }) => {
          settle();
          if (heardSomething) return;
          // A session that ends silently without an error event — WebKit does
          // this — is still "nothing came through" from where the person sits.
          onNotice(t(ERROR_MESSAGE_KEYS['no-speech']));
          buttonRef.current?.focus();
        },
      });
      setIsListening(true);
    } catch {
      // `startListening` throws only when the recogniser vanished between the
      // availability check and the tap. Same remedy as any other failure.
      settle();
      onNotice(t(ERROR_MESSAGE_KEYS.failed));
    }
  }, [i18n.language, onListenStart, onNotice, onTranscript, t]);

  const handleClick = (): void => {
    if (isListening) {
      // Stop, not cancel: whatever was said before the second tap is still
      // what the person meant to search for.
      sessionRef.current?.stop();
      return;
    }
    const action = resolveSpeakAction({ consented, available: true });
    if (action === 'ask-consent') {
      setIsAsking(true);
      return;
    }
    beginListening();
  };

  const handleConsent = (): void => {
    rememberSpeechConsent();
    setConsented(true);
    setIsAsking(false);
    beginListening();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        aria-pressed={isListening}
        aria-label={isListening ? t('add.speak.stop') : t('add.speak.start')}
        className={cn(
          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
          armed && !isListening && 'border-primary/50 text-primary',
          isListening && 'border-primary bg-primary/10 text-primary motion-safe:animate-pulse',
        )}
      >
        {isListening ?
          <Square className="h-4 w-4" />
        : <Mic className="h-4 w-4" />}
      </button>

      <AlertDialog open={isAsking} onOpenChange={setIsAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('add.speak.consent.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('add.speak.consent.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('add.speak.consent.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConsent}>{t('add.speak.consent.continue')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
