/**
 * The mounted content folder (`app/lib/content/content.server.ts` and
 * `content-route.server.ts`, M246 spec 01), on a real folder on disk.
 *
 * A temporary folder per test, written with neutral placeholder pages, so the
 * reader's disk half (stat, read, cache, fallback, refusal) runs for real. The
 * one thing faked is the logger, and only to count what it was told.
 *
 * ── EVERY RULE HAS A CONTROL ──
 * Traversal is refused, and the allow-listed slug beside it is read. The cache
 * returns the old page while the stat is unchanged, and the new page once the
 * stat moves. A refused German file is not replaced by the English one, and the
 * English one is served where no German file exists.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { createContentReader, parseContentDirectory } from '../../app/lib/content/content.server';
import { REFUSED_CONTENT_STATUS, hasLegalPages, loadContentPageOrThrow } from '../../app/lib/content/content-route.server';
import { ContentRefusedError } from '../../app/lib/content/markdown';
import type { LogMeta, Logger } from '../../app/lib/logger';
import { LANGUAGE_COOKIE } from '../../app/i18n/language-prefs';

/** One error line a logger was told. */
interface LoggedError {
  message: string;
  meta?: LogMeta;
}

/** A logger that records its error lines, and the lines it recorded. */
interface RecordingLogger {
  log: Logger;
  errors: LoggedError[];
}

function ignore(): void {}

/** A logger that records its error lines and drops the rest. */
function recordingLogger(): RecordingLogger {
  const errors: LoggedError[] = [];
  const log: Logger = {
    trace: ignore,
    debug: ignore,
    info: ignore,
    warn: ignore,
    error: (message, meta) => {
      errors.push({ message, meta });
    },
    fatal: ignore,
    child: () => log,
  };
  return { log, errors };
}

function page(input: { title: string; body: string }): string {
  return `---\ntitle: ${input.title}\nupdated: 2026-01-15\n---\n\n${input.body}\n`;
}

let root = '';

function write(input: { language: string; slug: string; content: string }): string {
  mkdirSync(join(root, input.language), { recursive: true });
  const path = join(root, input.language, `${input.slug}.md`);
  writeFileSync(path, input.content);
  return path;
}

/** Sets a file's modification time to a fixed instant, so a test controls exactly when the stat moves. */
function stamp(path: string, seconds: number): void {
  utimesSync(path, seconds, seconds);
}

/** The status a thrown `data()` response carries, read through a schema rather than a cast. */
const thrownDataSchema = z.object({ init: z.object({ status: z.number() }) });

async function statusThrownBy(promise: Promise<unknown>): Promise<number> {
  const thrown = await promise.then(
    () => assert.fail('the loader returned instead of throwing'),
    (cause: unknown) => cause,
  );
  return thrownDataSchema.parse(thrown).init.status;
}

/** A request carrying the language cookie the app reads. */
function requestIn(language: string): Request {
  return new Request('http://localhost/terms', { headers: { cookie: `${LANGUAGE_COOKIE}=${language}` } });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openplate-content-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a folder with no pages configured', () => {
  it('has no page and no legal pages', async () => {
    const reader = createContentReader({ directory: null });
    assert.equal(await reader.loadPage({ slug: 'terms', language: 'en' }), null);
    assert.equal(await reader.hasPage({ slug: 'imprint', language: 'en' }), false);
  });

  it('parses an unset or blank CONTENT_DIR as no folder', () => {
    assert.equal(parseContentDirectory(undefined), null);
    assert.equal(parseContentDirectory('   '), null);
  });

  it('stops the boot for a CONTENT_DIR that names no folder', () => {
    assert.throws(() => parseContentDirectory(join(root, 'missing')), /CONTENT_DIR is set to .*not a folder/);
    const aFile = join(root, 'a-file');
    writeFileSync(aFile, 'x');
    assert.throws(() => parseContentDirectory(aFile), /not a folder/);
  });

  it('CONTROL: an existing folder is taken, as an absolute path', () => {
    assert.equal(parseContentDirectory(root), root);
  });
});

describe('reading a page', () => {
  it('reads the page in the reader’s language', async () => {
    write({ language: 'en', slug: 'terms', content: page({ title: 'English fixture', body: 'Text.' }) });
    write({ language: 'de', slug: 'terms', content: page({ title: 'Deutsches Fixture', body: 'Text.' }) });
    const reader = createContentReader({ directory: root });
    const loaded = await reader.loadPage({ slug: 'terms', language: 'de' });
    assert.equal(loaded?.title, 'Deutsches Fixture');
    assert.equal(loaded?.language, 'de');
    assert.equal(loaded?.slug, 'terms');
  });

  it('falls back to English when the language has no file, and says so', async () => {
    write({ language: 'en', slug: 'terms', content: page({ title: 'English fixture', body: 'Text.' }) });
    const reader = createContentReader({ directory: root });
    const loaded = await reader.loadPage({ slug: 'terms', language: 'tr' });
    assert.equal(loaded?.title, 'English fixture');
    assert.equal(loaded?.language, 'en');
  });

  it('has no page when neither the language nor English has a file', async () => {
    write({ language: 'de', slug: 'privacy', content: page({ title: 'Nur Deutsch', body: 'Text.' }) });
    const reader = createContentReader({ directory: root });
    assert.equal(await reader.loadPage({ slug: 'terms', language: 'de' }), null);
    assert.equal(await reader.loadPage({ slug: 'privacy', language: 'fr' }), null);
  });

  it('holds a statutory page to its named sections', async () => {
    write({ language: 'en', slug: 'kuendigung', content: page({ title: 'Fixture', body: 'Lead only.' }) });
    const reader = createContentReader({ directory: root, log: recordingLogger().log });
    await assert.rejects(reader.loadPage({ slug: 'kuendigung', language: 'en' }), /"unavailable" is missing/);

    write({
      language: 'en',
      slug: 'kuendigung',
      content: page({ title: 'Fixture', body: 'Lead.\n\n:::section unavailable\nDown.\n:::' }),
    });
    const fixed = createContentReader({ directory: root });
    const loaded = await fixed.loadPage({ slug: 'kuendigung', language: 'en' });
    assert.equal(loaded?.sections[0]?.name, 'unavailable');
  });
});

describe('no path is built from a request', () => {
  it('refuses a slug that is not on the allow list, before touching the disk', async () => {
    // A file that a traversal WOULD reach, so a reader that built the path would find it.
    writeFileSync(join(root, 'secret.md'), page({ title: 'Outside the language folders', body: 'Secret.' }));
    const reader = createContentReader({ directory: join(root, 'content') });
    mkdirSync(join(root, 'content', 'en'), { recursive: true });
    for (const slug of ['../secret', '../../secret', 'en/../../secret', '/etc/passwd', 'terms/../../secret', '']) {
      await assert.rejects(reader.loadPage({ slug, language: 'en' }), /is not a content page slug/, slug);
      await assert.rejects(reader.hasPage({ slug, language: 'en' }), /is not a content page slug/, slug);
    }
  });

  it('refuses a language that is not one of the app’s', async () => {
    const reader = createContentReader({ directory: root });
    for (const language of ['..', '../en', 'en/..', 'xx', '']) {
      await assert.rejects(reader.loadPage({ slug: 'terms', language }), /is not one of/, language);
    }
  });

  it('CONTROL: the allow-listed slug and language are read', async () => {
    write({ language: 'en', slug: 'terms', content: page({ title: 'Allowed', body: 'Text.' }) });
    const reader = createContentReader({ directory: root });
    assert.equal((await reader.loadPage({ slug: 'terms', language: 'en' }))?.title, 'Allowed');
  });
});

describe('a file that breaks the contract', () => {
  it('is refused and logged with its problems, once per version of the file', async () => {
    const path = write({ language: 'en', slug: 'terms', content: page({ title: 'Fixture', body: '<script>x</script>' }) });
    stamp(path, 1_000_000);
    const { log, errors } = recordingLogger();
    const reader = createContentReader({ directory: root, log });

    await assert.rejects(reader.loadPage({ slug: 'terms', language: 'en' }), ContentRefusedError);
    await assert.rejects(reader.loadPage({ slug: 'terms', language: 'en' }), ContentRefusedError);
    assert.equal(errors.length, 1, 'the same version of the file is logged once');
    assert.equal(errors[0]?.meta?.file, 'en/terms.md');
    assert.match(JSON.stringify(errors[0]?.meta?.problems), /raw HTML/);

    // Fixed on disk: the next request serves it, with no restart.
    writeFileSync(path, page({ title: 'Fixed', body: 'Plain text.' }));
    stamp(path, 1_000_100);
    assert.equal((await reader.loadPage({ slug: 'terms', language: 'en' }))?.title, 'Fixed');
  });

  it('is not replaced by the English file', async () => {
    write({ language: 'en', slug: 'terms', content: page({ title: 'English fixture', body: 'Text.' }) });
    write({ language: 'de', slug: 'terms', content: page({ title: 'Kaputt', body: '<b>x</b>' }) });
    const reader = createContentReader({ directory: root, log: recordingLogger().log });
    await assert.rejects(reader.loadPage({ slug: 'terms', language: 'de' }), ContentRefusedError);
    // CONTROL: the same English file IS served where no German file exists.
    assert.equal((await reader.loadPage({ slug: 'terms', language: 'fr' }))?.title, 'English fixture');
  });

  it('refuses bytes that are not UTF-8', async () => {
    mkdirSync(join(root, 'en'), { recursive: true });
    writeFileSync(join(root, 'en', 'terms.md'), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a]));
    const reader = createContentReader({ directory: root, log: recordingLogger().log });
    await assert.rejects(reader.loadPage({ slug: 'terms', language: 'en' }), /not valid UTF-8/);
  });
});

describe('the cache', () => {
  it('reuses the parsed page while the file’s stat is unchanged, and rereads it once the stat moves', async () => {
    const path = write({ language: 'en', slug: 'terms', content: page({ title: 'Version AA', body: 'Text.' }) });
    stamp(path, 2_000_000);
    const reader = createContentReader({ directory: root });
    assert.equal((await reader.loadPage({ slug: 'terms', language: 'en' }))?.title, 'Version AA');

    // Same size, same modification time: the cache must answer, so the new
    // bytes are NOT seen. This is what proves there is a cache at all.
    writeFileSync(path, page({ title: 'Version BB', body: 'Text.' }));
    stamp(path, 2_000_000);
    assert.equal(statSync(path).size, Buffer.byteLength(page({ title: 'Version AA', body: 'Text.' })));
    assert.equal((await reader.loadPage({ slug: 'terms', language: 'en' }))?.title, 'Version AA');

    // The edit a mount receives moves the modification time: the next read sees it.
    stamp(path, 2_000_060);
    assert.equal((await reader.loadPage({ slug: 'terms', language: 'en' }))?.title, 'Version BB');
  });

  it('rereads a file whose size changed even at the same modification time', async () => {
    const path = write({ language: 'en', slug: 'terms', content: page({ title: 'Short', body: 'Text.' }) });
    stamp(path, 3_000_000);
    const reader = createContentReader({ directory: root });
    assert.equal((await reader.loadPage({ slug: 'terms', language: 'en' }))?.title, 'Short');
    writeFileSync(path, page({ title: 'A longer title', body: 'Text.' }));
    stamp(path, 3_000_000);
    assert.equal((await reader.loadPage({ slug: 'terms', language: 'en' }))?.title, 'A longer title');
  });
});

describe('what a route answers', () => {
  it('answers 404 for a page with no file', async () => {
    const reader = createContentReader({ directory: root });
    assert.equal(await statusThrownBy(loadContentPageOrThrow({ request: requestIn('en'), slug: 'terms', reader })), 404);
  });

  it(`answers ${REFUSED_CONTENT_STATUS} for a file that breaks the contract`, async () => {
    write({ language: 'en', slug: 'terms', content: page({ title: 'Fixture', body: '<i>x</i>' }) });
    const reader = createContentReader({ directory: root, log: recordingLogger().log });
    assert.equal(await statusThrownBy(loadContentPageOrThrow({ request: requestIn('en'), slug: 'terms', reader })), 503);
  });

  it('CONTROL: answers the page for a good file, in the cookie’s language', async () => {
    write({ language: 'en', slug: 'terms', content: page({ title: 'English fixture', body: 'Text.' }) });
    write({ language: 'it', slug: 'terms', content: page({ title: 'Fixture italiano', body: 'Testo.' }) });
    const reader = createContentReader({ directory: root });
    const loaded = await loadContentPageOrThrow({ request: requestIn('it'), slug: 'terms', reader });
    assert.equal(loaded.title, 'Fixture italiano');
  });

  it('shows legal links only where the imprint exists, in the language or in English', async () => {
    const reader = createContentReader({ directory: root });
    assert.equal(await hasLegalPages({ request: requestIn('de'), reader }), false);
    write({ language: 'en', slug: 'terms', content: page({ title: 'Terms only', body: 'Text.' }) });
    assert.equal(await hasLegalPages({ request: requestIn('de'), reader }), false, 'terms alone is not enough');
    write({ language: 'en', slug: 'imprint', content: page({ title: 'Fixture imprint', body: 'Text.' }) });
    assert.equal(await hasLegalPages({ request: requestIn('de'), reader }), true);
  });
});
