/**
 * The instance-settings form (M234 spec 07): what it accepts, what it refuses,
 * what it sends, and what a refused administrator gets instead of a blank page.
 *
 * ── FOUR PROPERTIES, AND EACH ONE HAS A CONTROL ──────────────────────────
 *
 *  1. The schema takes each of the three names and refuses a fourth. The
 *     control is the valid parse beside the invalid one: a schema that accepted
 *     everything would pass the first assertion alone.
 *  2. A submission with no basis at all is refused. That is not a hypothetical
 *     shape: it is what a form nobody touched posts, and it is the one body
 *     `PATCH /v1/admin/settings` answers `400` to.
 *  3. `patchSettings` makes exactly the request the contract names, and turns a
 *     `403` into a VALUE. The control is the 500 beside it, which still throws:
 *     an implementation that swallowed everything would pass the 403 case.
 *  4. The screen a `403` produces renders. `NotAnAdministratorCard` is the
 *     component the route puts on screen in that branch, and it is rendered
 *     here against the real English catalog, so a renamed key fails here rather
 *     than showing an administrator `admin.notAdmin.title`.
 *
 * ── NO TRANSLATED PROSE IS PINNED ────────────────────────────────────────
 *
 * The render assertions ask whether a key RESOLVED, never what it resolved to:
 * a copy edit is somebody doing their job, and a test that broke on one would
 * teach the next person to stop editing copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { InstanceSettingsCard } from '../../app/components/admin/instance-settings-card';
import { NotAnAdministratorCard } from '../../app/components/admin/not-an-administrator';
import { makeInstanceSettingsSchema } from '../../app/lib/admin/settings-schema';
import { AdminClient, type AdminTransport } from '../../app/lib/admin/admin-client';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import type { AuthorizedMethod } from '../../app/lib/sync/engine/client/auth-client';
import type { JsonValue } from '../../app/lib/sync/engine/protocol';
import { z } from 'zod';

/** The identity translator: the schema takes `t` for its message, and a test has no catalog to resolve against. */
const t = (key: string): string => key;

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, withI18n(element)));
}

/** One request as the client made it, the same shape `admin-client.test.ts` pins every other method with. */
interface RecordedRequest {
  path: string;
  method: AuthorizedMethod;
  body: JsonValue | undefined;
}

function transportAnswering(input: { answer: JsonValue | Error; recorded: RecordedRequest[] }): AdminTransport {
  return {
    async requestAsAccount(request: { path: string; method: AuthorizedMethod; body?: JsonValue }): Promise<JsonValue> {
      input.recorded.push({ path: request.path, method: request.method, body: request.body });
      if (input.answer instanceof Error) throw input.answer;
      return input.answer;
    },
    requestBytesAsAccount(): Promise<never> {
      throw new Error('the settings form reads no bytes');
    },
  };
}

// ---------------------------------------------------------------------------
// 1 and 2. The form's own rules
// ---------------------------------------------------------------------------

test('the settings form takes each of the three published bases', () => {
  const schema = makeInstanceSettingsSchema(t);

  for (const basis of ['dge', 'efsa', 'us']) {
    const parsed = schema.safeParse({ nutrientReferenceBasis: basis });
    assert.equal(parsed.success, true, `${basis} is one of the three names the wire carries`);
    assert.equal(parsed.data?.nutrientReferenceBasis, basis);
  }
});

test('the settings form refuses a basis nobody publishes, with a message of its own', () => {
  const parsed = makeInstanceSettingsSchema(t).safeParse({ nutrientReferenceBasis: 'martian' });

  assert.equal(parsed.success, false, 'a fourth name must never reach the service');
  assert.deepEqual(
    parsed.error?.issues.map((issue) => issue.path.join('.')),
    ['nutrientReferenceBasis'],
    'the message belongs to the control the person can change',
  );
  assert.equal(parsed.error?.issues[0]?.message, 'admin.settings.invalid', 'the message is translated, not zod English');
});

test('a submission that names no basis at all is refused here rather than at the service', () => {
  // The body `PATCH /v1/admin/settings` answers 400 to, and the ordinary
  // result of a form nobody touched.
  const parsed = makeInstanceSettingsSchema(t).safeParse({});

  assert.equal(parsed.success, false);
});

// ---------------------------------------------------------------------------
// 3. The call
// ---------------------------------------------------------------------------

test('patchSettings sends the transcribed request and reads the answer back off the envelope', async () => {
  const recorded: RecordedRequest[] = [];
  const client = new AdminClient({
    transport: transportAnswering({ answer: { settings: { nutrientReferenceBasis: 'efsa' } }, recorded }),
  });

  const outcome = await client.patchSettings({ nutrientReferenceBasis: 'efsa' });

  assert.deepEqual(recorded, [
    { path: '/v1/admin/settings', method: 'PATCH', body: { nutrientReferenceBasis: 'efsa' } },
  ]);
  assert.deepEqual(outcome, { status: 'ok', value: { nutrientReferenceBasis: 'efsa' } });
});

test('a 403 is a value the page can render, and a 500 is still a throw', async () => {
  const recorded: RecordedRequest[] = [];
  const refused = new AdminClient({
    transport: transportAnswering({
      answer: new SyncRequestError({ kind: 'forbidden', status: 403, message: 'not an administrator' }),
      recorded,
    }),
  });

  assert.deepEqual(await refused.patchSettings({ nutrientReferenceBasis: 'dge' }), { status: 'forbidden' });

  // THE CONTROL. A client that turned every failure into an outcome would pass
  // the assertion above and hide a broken service behind the same card.
  const broken = new AdminClient({
    transport: transportAnswering({
      answer: new SyncRequestError({ kind: 'server', status: 500, message: 'it fell over' }),
      recorded,
    }),
  });
  await assert.rejects(() => broken.patchSettings({ nutrientReferenceBasis: 'dge' }));
});

// ---------------------------------------------------------------------------
// 4. The screens
// ---------------------------------------------------------------------------

test('the card draws one control per basis, with the instance’s own answer already chosen', () => {
  const html = render(
    createElement(InstanceSettingsCard, { basis: 'efsa', state: 'form', failure: null, onSubmit: () => {} }),
  );

  for (const basis of ['dge', 'efsa', 'us']) {
    assert.match(html, new RegExp(`value="${basis}"`), `${basis} must be offerable`);
  }
  // React emits `checked` BEFORE `value`, so the order here is the renderer's,
  // not a preference.
  assert.match(html, /checked=""[^>]*value="efsa"/, 'the basis this instance holds is the one already chosen');
  assert.equal((html.match(/checked=""/g) ?? []).length, 1, 'and it is the only one chosen');
  // The reload sentence is the honest disclosure, so its ABSENCE is a defect.
  // Asserted as "the key resolved", never as the sentence itself.
  assert.doesNotMatch(html, /admin\.settings\./, 'every key in this card resolves against the shipped catalog');
});

test('a server that publishes no basis gets a sentence instead of a control that cannot work', () => {
  const html = render(
    createElement(InstanceSettingsCard, { basis: null, state: 'form', failure: null, onSubmit: () => {} }),
  );

  assert.doesNotMatch(html, /type="radio"/, 'a form here would write to a route that answers 404');
  assert.doesNotMatch(html, /admin\.settings\./);
});

test('the refusal a 403 produces is a card, not a blank page', () => {
  const html = render(createElement(NotAnAdministratorCard));

  assert.notEqual(html, '', 'the branch the route takes on `forbidden` renders something');
  assert.doesNotMatch(html, /admin\.notAdmin\./, 'and it renders sentences rather than key names');
});

// ---------------------------------------------------------------------------
// 5. The copy exists in every language this app ships
// ---------------------------------------------------------------------------

/**
 * Every leaf under `admin.settings`, plus the tab that leads to it, in all six
 * locales.
 *
 * WHAT IS ASSERTED IS THAT THE KEY RESOLVES, never what it says. English is
 * the fallback, so a key missing from a translated catalog renders an English
 * sentence on a German page and nothing at runtime says so; that is the defect
 * this checks for, and pinning a translated phrase would only teach the next
 * person to stop improving one.
 */
/** A translation catalog: nested groups bottoming out in strings, parsed rather than asserted. */
interface Catalog {
  [key: string]: string | Catalog;
}

const catalogSchema: z.ZodType<Catalog> = z.lazy(() => z.record(z.string(), z.union([z.string(), catalogSchema])));

/** One translated sentence. A group parsed with this fails, which is how a walk tells a leaf from a branch. */
const leafSchema = z.string();

function loadCatalog(locale: string): Catalog {
  const url = new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url);
  return catalogSchema.parse(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')));
}

/** What sits at a dotted path: a sentence, a group, or nothing at all. */
function nodeAt(catalog: Catalog, path: string): string | Catalog | null {
  let here: string | Catalog = catalog;
  for (const step of path.split('.')) {
    const group = catalogSchema.safeParse(here);
    if (!group.success) return null;
    const next = group.data[step];
    if (next === undefined) return null;
    here = next;
  }
  return here;
}

/** The sentence at a dotted path, or `null` for a group, an absent key, or an empty string. */
function sentenceAt(catalog: Catalog, path: string): string | null {
  const node = nodeAt(catalog, path);
  const leaf = node === null ? null : leafSchema.safeParse(node);
  if (leaf === null || !leaf.success || leaf.data.trim() === '') return null;
  return leaf.data;
}

/** Every dotted path under one group, read off the ENGLISH catalog, which is the source of record. */
function leafPathsUnder(catalog: Catalog, prefix: string): string[] {
  const node = nodeAt(catalog, prefix);
  const group = node === null ? null : catalogSchema.safeParse(node);
  if (group === null || !group.success) return [prefix];
  return Object.keys(group.data).flatMap((key) => leafPathsUnder(catalog, `${prefix}.${key}`));
}

test('the settings copy resolves in all six locales', () => {
  const english = loadCatalog('en');
  const paths = ['admin.tabs.settings', ...leafPathsUnder(english, 'admin.settings')];
  assert.ok(paths.length > 10, 'the list under test is the whole card, not one key');

  const missing: string[] = [];
  for (const locale of ['en', 'de', 'es', 'fr', 'it', 'tr']) {
    const catalog = loadCatalog(locale);
    for (const path of paths) {
      if (sentenceAt(catalog, path) === null) missing.push(`${locale}:${path}`);
    }
  }

  assert.deepEqual(missing, []);

  // THE CONTROL: the same read, for a key nobody wrote. Without it, a lookup
  // that answered a string for everything would pass the assertion above.
  assert.equal(sentenceAt(english, 'admin.settings.thereIsNoSuchKey'), null);
});
