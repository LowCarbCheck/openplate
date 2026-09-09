/**
 * Typed intake reaches the SAME screen the photo does.
 *
 * The whole change is a claim about one pipeline, and a pipeline is exactly
 * what a unit test of a pure function cannot see: `/add` hands words to a
 * module slot, `/scan` reads that slot in an effect, and the review screen is
 * the plate path's. There is no DOM test library in this repo, so the chain is
 * proved by reading the two routes at anchored points, the same way
 * `scan-mode-event.test.ts` proves what does and does not fire.
 *
 * WHAT WOULD BREAK SILENTLY WITHOUT THIS. A second review screen for text. A
 * `/add?q=` navigation instead of the hand-off slot, which would put what
 * somebody ate into their browser history. A confirm that files a typed meal
 * under the photo path, which is the only place the ways in are still
 * distinguishable.
 *
 * The `speech` source is still read on the way OUT of the slot (`/scan` maps it
 * to its own analytics path) because entries written before M203 removed the
 * in-app microphone carry it. Nothing produces it any more, which is why no
 * assertion here expects a transcript.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ADD_ROUTE = readFileSync(new URL('../../app/routes/add.tsx', import.meta.url), 'utf8');
const SCAN_ROUTE = readFileSync(new URL('../../app/routes/scan.tsx', import.meta.url), 'utf8');

/**
 * The source between two anchors, so a body is read whole rather than up to
 * the first closing paren a lazy regex happens to find.
 */
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from !== -1, `anchor not found: ${start}`);
  assert.ok(to > from, `anchor not found after ${start}: ${end}`);
  return source.slice(from, to);
}

/** The body of `/add`'s AI submit helper. */
const SUBMIT_TO_AI = between(ADD_ROUTE, 'const submitToAi = useCallback(', 'const grouped = groupCandidatesBySource');

describe('/add hands words to /scan', () => {
  it('parks them in the one-shot slot rather than in the URL', () => {
    assert.match(ADD_ROUTE, /import \{ offerTypedText \} from '#app\/lib\/scan-handoff'/);
    assert.match(SUBMIT_TO_AI, /offerTypedText\(trimmed, source\)/);
    assert.match(SUBMIT_TO_AI, /navigate\(scanHref\)/);
    // Never a query parameter: a search term is one thing in a history entry,
    // a meal is another.
    assert.doesNotMatch(SUBMIT_TO_AI, /\?q=|searchParams/);
  });

  it('refuses to spend a paid call on an empty box', () => {
    assert.match(SUBMIT_TO_AI, /if \(trimmed === ''\) return;/);
  });

  it('offers the AI action only once an AI is known to exist', () => {
    assert.match(ADD_ROUTE, /import \{ useAiIntake \} from '#app\/components\/add\/use-ai-connection'/);
    assert.match(ADD_ROUTE, /const \{ connection: aiConnection, door: aiDoor \} = useAiIntake\(\);/);
    assert.match(ADD_ROUTE, /const hasAiProvider = aiConnection === 'connected';/);
    assert.match(ADD_ROUTE, /\{hasAiProvider && \([\s\S]*?t\('add\.aiIntake\.submit'\)/);
  });

  it('explains the gap through the shared notice, which knows where the door is', () => {
    // NEVER `/settings/ai` unconditionally (0.20.0 blocker): a managed
    // instance redirects that page away and nobody there brings a provider.
    // The BYOK sentence and its link are handed to the notice as the branch
    // that is true only on an open instance.
    assert.match(ADD_ROUTE, /\{aiConnection === 'absent' && \([\s\S]*?<NoAiIntakeNotice/);
    assert.match(ADD_ROUTE, /door=\{aiDoor\}/);
    assert.match(ADD_ROUTE, /byokMessage=\{t\('add\.aiIntake\.needsProvider'\)\}/);
    assert.match(ADD_ROUTE, /byokHref="\/settings\/ai\?next=add"/);
  });

  it('keeps the database search rendering under the box either way', () => {
    // The result sections are outside every AI branch, so a person who wants
    // one exact database entry still gets it in one tap.
    assert.match(ADD_ROUTE, /\{candidates\.length > 0 && \([\s\S]*?add\.search\.sections\.recent/);
  });

  it('reaches for no microphone of its own', () => {
    // M203 removed the Web Speech button. It reported every failure to an
    // `sr-only` live region, so on a phone it was a control that visibly did
    // nothing; dictation is the keyboard's now and arrives as ordinary typing.
    for (const forbidden of ['SpeechInputButton', 'useSpeechInputAvailable', 'resolveSpeechIntakeAction', 'speak']) {
      assert.ok(!ADD_ROUTE.includes(forbidden), `/add still reaches for speech (${forbidden})`);
    }
    // The control on the check above: the words themselves still travel, so a
    // file that had simply lost the whole submit path would fail here.
    assert.match(SUBMIT_TO_AI, /offerTypedText\(trimmed, source\)/);
  });
});

describe('/scan runs the text task on what it was handed', () => {
  it('reads either kind out of the one slot, exactly once', () => {
    const handoff = SCAN_ROUTE.slice(
      SCAN_ROUTE.indexOf('const handed = takeIntakeHandoff();'),
      SCAN_ROUTE.indexOf('// Web Share Target v2'),
    );
    assert.ok(handoff.length > 0, 'the hand-off effect was not found');
    assert.match(handoff, /if \(handed\.kind === 'text'\)/);
    assert.match(handoff, /processTextHandoffRef\.current\(handed\.text, handed\.source\)/);
  });

  it('sends the words as a text intake, never as an empty photo field', () => {
    assert.match(
      SCAN_ROUTE,
      /formData\.append\('intake', 'text'\);\s*\n\s*formData\.append\('text', typedText\);/,
      'the dispatch no longer posts the typed text as a text intake',
    );
  });

  it('runs the text task and rejoins the plate path', () => {
    assert.match(SCAN_ROUTE, /runTextIntake\(\{ task: TEXT_INTAKE_TASK, text: context\.text \}\)/);
    assert.match(SCAN_ROUTE, /return completePlateIntake\(\{ identification, context \}\)/);
    // One shared completion for both, so the empty-result accounting and the
    // curated enrichment cannot diverge between them.
    assert.strictEqual(SCAN_ROUTE.split('completePlateIntake({ identification, context })').length - 1, 2);
  });

  it('reuses the plate review screen and the plate confirm, unforked', () => {
    // One confirm intent for the plate shape. A second one would be a second
    // review screen wearing the first one's name.
    assert.strictEqual(SCAN_ROUTE.split('<ConfirmDraftForm').length - 1, 1);
    assert.doesNotMatch(SCAN_ROUTE, /TextConfirmForm|handleConfirmText/);
  });

  it('shows the words where a photo would show its preview', () => {
    assert.match(SCAN_ROUTE, /\{isTextIntake && \(\s*\n\s*<figure/);
    assert.match(SCAN_ROUTE, /<blockquote className="[^"]*">\{typedText\}<\/blockquote>/);
    // And the photo preview is suppressed, rather than both being rendered.
    assert.match(SCAN_ROUTE, /\{!isTextIntake && file && previewUrl && \(/);
  });

  it('files the confirmed batch under the way in that produced it', () => {
    assert.match(SCAN_ROUTE, /trackFoodLogged\(SCAN_LOG_PATH_BY_SOURCE\[readIntakeSource\(formData\)\]\)/);
    assert.match(SCAN_ROUTE, /photo: 'scan-plate',\s*\n\s*text: 'scan-text',\s*\n\s*speech: 'scan-speech',/);
    // The hidden field that carries it, outside every collapsible.
    assert.match(SCAN_ROUTE, /<input type="hidden" name="intakeSource" value=\{intakeSource\} \/>/);
  });

  it('never lets a photo and a sentence be pending at the same time', () => {
    // Each entry point clears the other, which is what makes the dispatch's
    // `typedText !== null` branch a real discriminator rather than a race.
    assert.match(SCAN_ROUTE, /setTypedText\(null\);\s*\n\s*setIntakeSource\('photo'\);\s*\n\s*setFile\(nextFile\);/);
    assert.match(SCAN_ROUTE, /setFile\(null\);\s*\n\s*setTypedText\(text\);/);
  });
});
