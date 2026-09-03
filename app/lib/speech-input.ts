/**
 * The app's one and only contact point with the browser's Web Speech API.
 *
 * WHY A WRAPPER. `SpeechRecognition` is not a normal web platform API for us:
 * it is vendor infrastructure wearing a standard name. On Chrome the audio is
 * streamed to Google's servers, on Safari to Apple's; only Firefox has no
 * implementation at all. That is a privacy fact the person must be told about
 * once (see `hasGivenSpeechConsent`), and it is a fact that could change per
 * engine. Keeping the vendor object behind `startListening` means the whole
 * app knows exactly one sentence about speech ("start, get a transcript, stop")
 * and the day this is replaced by an on-device recogniser, one file changes.
 *
 * WHY THE TYPES ARE OURS. TypeScript 7.0.2's `lib.dom.d.ts` ships
 * `SpeechRecognitionEvent`, `SpeechRecognitionErrorEvent` and
 * `SpeechRecognitionErrorCode`, but NOT the `SpeechRecognition` interface or
 * its constructor — the API is still behind a vendor prefix on WebKit and is
 * not in the baseline DOM lib. So the constructor shape below is declared here
 * rather than imported, and the `Window` augmentation is what lets the
 * detection read `window.SpeechRecognition ?? window.webkitSpeechRecognition`
 * with no type assertion anywhere.
 *
 * NOTHING HERE RUNS ON THE SERVER. Every entry point either takes the scope
 * explicitly or defaults to `globalThis.window`, and treats its absence as
 * "speech is not available" — the same shape as `weight-unit-preference.ts`.
 */

/** The three recogniser events this app listens for, and what each one carries. */
interface SpeechRecognitionEventMap {
  result: SpeechRecognitionEvent;
  error: SpeechRecognitionErrorEvent;
  end: Event;
}

/** The subset of `SpeechRecognition` this app drives. Declared locally — see this module's header for why it is not in `lib.dom.d.ts`. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  addEventListener<K extends keyof SpeechRecognitionEventMap>(
    type: K,
    listener: (event: SpeechRecognitionEventMap[K]) => void,
  ): void;
  start(): void;
  stop(): void;
  abort(): void;
}

/** The constructor both the standard and the WebKit-prefixed global expose. */
export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

/**
 * Anything that might carry the two speech globals — the real `window` in the
 * browser, a plain object in a test. Every property optional on purpose: the
 * whole point of the detection is that a browser may have neither.
 */
export interface SpeechCapableScope {
  SpeechRecognition?: SpeechRecognitionConstructor | undefined;
  webkitSpeechRecognition?: SpeechRecognitionConstructor | undefined;
}

/**
 * The errors this app is prepared to say something honest about.
 *
 * Deliberately three, not eight. The person can act on exactly three things:
 * grant the microphone, speak again, or give up and type. Every remaining
 * `SpeechRecognitionErrorCode` (network, audio-capture, language-not-supported)
 * lands on `'failed'`, whose copy already points at the only remedy left.
 */
export type SpeechInputError = 'permission-denied' | 'no-speech' | 'failed';

/** A live listening session. `stop` ends it and keeps whatever was heard; `cancel` throws it away (unmount). */
export interface SpeechInputSession {
  stop(): void;
  cancel(): void;
}

export interface StartListeningOptions {
  /** BCP-47 tag for the recogniser — build it with `speechLanguageTag`, never from a raw UI language. */
  language: string;
  /** Called at most once, with the final transcript, trimmed and non-empty. */
  onResult: (transcript: string) => void;
  /** Called exactly once when the session is over, whether or not anything was heard. Always after `onResult`/`onError`. */
  onEnd: (outcome: { heardSomething: boolean }) => void;
  /** Called at most once, before `onEnd`. */
  onError: (error: SpeechInputError) => void;
}

/** The recogniser constructor this browser offers, or `null` when it offers none. */
function speechRecognitionConstructor(scope: SpeechCapableScope | undefined): SpeechRecognitionConstructor | null {
  if (scope === undefined) return null;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/**
 * Whether this browser can turn speech into text at all.
 *
 * MUST be called from the client, after hydration — never during render on the
 * server, where the answer is always `false` and would bake a missing button
 * into the markup. Firefox answers `false` today (no implementation), and that
 * is a supported outcome, not a degraded one: the search field is typed into.
 *
 * @param scope - the globals to inspect; defaults to the real `window`.
 * @returns `true` when a recogniser constructor exists.
 */
export function isSpeechInputAvailable(scope: SpeechCapableScope | undefined = globalThis.window): boolean {
  return speechRecognitionConstructor(scope) !== null;
}

/**
 * Default regions for the UI languages the app ships, used only when the UI
 * language carries no region of its own.
 *
 * A recogniser given a bare `de` is free to guess a variety; naming one is what
 * keeps a German speaker's "Hähnchenbrust" from being scored against Austrian
 * or Swiss pronunciation models. `en-US` over `en-GB` follows
 * `app/i18n/date-locale.ts`, which already made this call for clock times.
 */
const DEFAULT_SPEECH_REGIONS = new Map([
  ['de', 'de-DE'],
  ['en', 'en-US'],
]);

/** The tag used when the UI language is missing or unusable — the app's own default language. */
const FALLBACK_SPEECH_TAG = 'en-US';

/**
 * Maps a react-i18next UI language onto the BCP-47 tag the recogniser wants.
 *
 * Pure, and the only place the mapping exists. Three cases, in order:
 * a tag that already names a region is trusted and only normalised in case
 * (`de-de` → `de-DE`); a bare language gets this app's default region for it;
 * anything else — a bare language we ship no default for, or an empty string —
 * falls back rather than handing the recogniser a tag it may reject outright.
 *
 * @param uiLanguage - `i18n.language`, e.g. `'de'`, `'en-GB'`, `'de-AT'`.
 * @returns a BCP-47 tag safe to assign to `SpeechRecognition.lang`.
 */
export function speechLanguageTag(uiLanguage: string): string {
  // `split` always yields at least one element, so `parts[0]` is a real string
  // even for the empty input — which the emptiness guard below then rejects.
  const parts = uiLanguage.trim().split(/[-_]/u);
  const language = parts[0].toLowerCase();
  if (language === '') return FALLBACK_SPEECH_TAG;
  const region = parts.length > 1 ? parts[1] : '';
  if (region !== '') return `${language}-${region.toUpperCase()}`;
  return DEFAULT_SPEECH_REGIONS.get(language) ?? FALLBACK_SPEECH_TAG;
}

/**
 * Narrows a `SpeechRecognitionErrorCode` to the three outcomes this app has
 * copy for. `'aborted'` is not an error at all — it is what our own `cancel`
 * produces — and is mapped to `'failed'` only for callers that reach it by
 * another route; the session below never forwards it.
 */
export function classifySpeechError(code: SpeechRecognitionErrorCode): SpeechInputError {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'permission-denied';
  if (code === 'no-speech') return 'no-speech';
  return 'failed';
}

/** Pulls the best final transcript out of a result event, trimmed. Empty string when the event carried nothing usable. */
function readTranscript(event: SpeechRecognitionEvent): string {
  const results = event.results;
  if (results.length === 0) return '';
  const result = results[results.length - 1];
  if (result.length === 0) return '';
  return result[0].transcript.trim();
}

/**
 * Starts one listening session and hands back the handle that ends it.
 *
 * CALL THIS FROM A CLICK HANDLER. The browser only grants microphone access
 * inside a user gesture, so every call site is a tap — there is no auto-start
 * path in this app, by design and by platform.
 *
 * The session is single-shot (`continuous: false`, `interimResults: false`):
 * the person says a food, the recogniser settles, the transcript arrives once.
 * Streaming interim text into the search field would fire a network search per
 * syllable.
 *
 * @param options - language plus the three callbacks; see `StartListeningOptions`.
 * @returns the handle to stop (keep what was heard) or cancel (discard).
 * @throws when called in a browser without a recogniser — guard with `isSpeechInputAvailable`.
 */
export function startListening({ language, onResult, onEnd, onError }: StartListeningOptions): SpeechInputSession {
  const Recognition = speechRecognitionConstructor(globalThis.window);
  if (Recognition === null) {
    throw new Error('startListening called without speech support — guard the call with isSpeechInputAvailable().');
  }

  const recognition = new Recognition();
  recognition.lang = language;
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let heardSomething = false;
  let cancelled = false;

  recognition.addEventListener('result', (event) => {
    if (cancelled) return;
    const transcript = readTranscript(event);
    if (transcript === '') return;
    heardSomething = true;
    onResult(transcript);
  });

  recognition.addEventListener('error', (event) => {
    if (cancelled) return;
    // Our own `cancel` is the only producer of `aborted`, and it has already
    // silenced this handler — so reaching here with it would be a browser
    // quirk, not a failure the person caused. Say nothing and let `end` run.
    if (event.error === 'aborted') return;
    onError(classifySpeechError(event.error));
  });

  recognition.addEventListener('end', () => {
    if (cancelled) return;
    onEnd({ heardSomething });
  });

  recognition.start();

  return {
    stop: () => recognition.stop(),
    cancel: () => {
      cancelled = true;
      recognition.abort();
    },
  };
}

////////////////////////////////////////////////////////////////////////////////
// One-time consent
////////////////////////////////////////////////////////////////////////////////

/**
 * Browser-local marker that this device's owner has been told where the audio
 * goes and said yes.
 *
 * `localStorage`, not the primary store: this is a per-device permission-ish
 * preference in the same family as `openplate:weight-unit`, and it must never
 * ride a backup export or a sync payload to another device. Consent is given
 * by a person on a device, and does not travel.
 */
export const SPEECH_CONSENT_STORAGE_KEY = 'openplate:speech-consent';

/** The stored marker's only accepted value. Presence alone is the consent; the value exists so a stray key can't pass for one. */
const SPEECH_CONSENT_VALUE = 'granted';

/**
 * Whether this device has already accepted the vendor-audio disclosure.
 *
 * @returns `false` when unset, unreadable (private mode) or off the browser.
 */
export function hasGivenSpeechConsent(): boolean {
  if (globalThis.window === undefined) return false;
  try {
    return window.localStorage.getItem(SPEECH_CONSENT_STORAGE_KEY) === SPEECH_CONSENT_VALUE;
  } catch {
    // A browser that refuses storage gets asked every time, which is the safe
    // direction: worst case the person confirms again, never listens unasked.
    return false;
  }
}

/** Records the acceptance. A write failure is swallowed — the consent still holds for this session, it just won't be remembered. */
export function rememberSpeechConsent(): void {
  if (globalThis.window === undefined) return;
  try {
    window.localStorage.setItem(SPEECH_CONSENT_STORAGE_KEY, SPEECH_CONSENT_VALUE);
  } catch {
    // Ignored by design — see this function's doc.
  }
}

/** What a tap on the microphone button should do, or `'hidden'` when there is no button to tap. */
export type SpeakAction = 'hidden' | 'ask-consent' | 'listen';

/**
 * The whole gate, as one pure decision: no recogniser means no button at all,
 * and the first listen on a consenting-but-not-yet-asked device must open the
 * disclosure rather than open the microphone.
 *
 * Kept pure and separate from the button so the invariant that matters — that
 * a device which has never consented can never reach `'listen'` — is provable
 * without a DOM.
 *
 * @param input.consented - result of `hasGivenSpeechConsent` for this device.
 * @param input.available - result of `isSpeechInputAvailable` for this browser.
 */
export function resolveSpeakAction({ consented, available }: { consented: boolean; available: boolean }): SpeakAction {
  if (!available) return 'hidden';
  return consented ? 'listen' : 'ask-consent';
}
