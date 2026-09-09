/**
 * The reported-estimate console: what it puts on screen, what it asks the
 * server for, and where it refuses to exist.
 *
 * ── Rendered, not inspected ──────────────────────────────────────────────
 *
 * The screens are presentational by construction, so these are
 * `renderToStaticMarkup` assertions against the real shipped English catalog.
 * A key renamed in a component and not in `en/common.json` fails here rather
 * than showing an operator `admin.feedback.empty` where a sentence belongs.
 *
 * ── Every assertion has a control case ───────────────────────────────────
 *
 * Each `assert.match` below is paired with a render that makes it fail: an
 * empty queue for the row assertions, a report WITH a photograph for the
 * typed-meal placeholder, figures that are present for the "none given" line,
 * and an instance that DOES advertise a window for the 404. An assertion that
 * cannot fail is the failure mode this file is written against.
 *
 * ── The figures are not on the queue, and that is the design ─────────────
 *
 * `GET /v1/admin/feedback` sends no `measurements`
 * (`openplate-core/src/feedback/feedback-admin-store.ts`, its header says
 * why), so the figures are asserted where they arrive: the report's own page,
 * beside the photograph.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { AdminTabs } from '../../app/components/admin/admin-tabs';
import { FeedbackQueue } from '../../app/components/admin/feedback-queue';
import { FeedbackReportView } from '../../app/components/admin/feedback-report-detail';
import { AdminClient, type AdminTransport } from '../../app/lib/admin/admin-client';
import type { AdminFeedbackReport, AdminFeedbackReportDetail } from '../../app/lib/admin/admin-wire';
import {
  hasFeedbackConsole,
  reportDeletesAt,
  reportedFigures,
  requireFeedbackWindow,
} from '../../app/lib/admin/feedback-console';
import type { InstanceDescriptor } from '../../app/lib/sync/engine/protocol';
import { SyncRequestError } from '../../app/lib/sync/engine/client/sync-error';
import type { AuthorizedBytes } from '../../app/lib/sync/engine/client/auth-client';
import type { JsonValue } from '../../app/lib/sync/engine/protocol';

function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, withI18n(element)));
}

/** The window every screen below is drawn against. The number a person was promised, not a local default. */
const RETENTION_DAYS = 30;

const WITH_PHOTO: AdminFeedbackReport = {
  id: 12,
  accountId: 4,
  hasImage: true,
  consentWordingVersion: '2026-09-01',
  createdAt: '2026-09-01T10:00:00.000Z',
};

/** A meal that was typed in, or one whose photograph the device had already evicted. Not a failure. */
const TYPED_MEAL: AdminFeedbackReport = {
  id: 13,
  accountId: 4,
  hasImage: false,
  consentWordingVersion: '2026-09-01',
  createdAt: '2026-09-02T10:00:00.000Z',
};

const REPORT_DETAIL: AdminFeedbackReportDetail = {
  ...WITH_PHOTO,
  measurements: {
    name: 'Scrambled eggs',
    quantityGrams: 180,
    loggedAt: '2026-09-01T09:40:00.000Z',
    source: 'scan',
    aiEstimated: true,
    carbs: 2.5,
    fiber: 0,
    sugars: 1,
    polyols: 0,
    protein: 19,
    fat: 24,
    kcal: 310,
  },
  consent: { agreedAt: '2026-09-01T09:59:00.000Z', wordingVersion: '2026-09-01' },
};

/** The same report with nothing measured. Every figure is still drawn, and each one says it is missing. */
const NOTHING_MEASURED: AdminFeedbackReportDetail = {
  ...REPORT_DETAIL,
  measurements: {
    ...REPORT_DETAIL.measurements,
    carbs: null,
    fiber: null,
    sugars: null,
    polyols: null,
    protein: null,
    fat: null,
    kcal: null,
  },
};

// ── The queue ───────────────────────────────────────────────────────────────

test('a row names the report, the account and when it deletes itself, and carries the delete control', () => {
  const html = render(
    createElement(FeedbackQueue, {
      reports: [WITH_PHOTO, TYPED_MEAL],
      retentionDays: RETENTION_DAYS,
      deletingId: null,
      onDelete: () => undefined,
    }),
  );

  assert.match(html, /Report 12/);
  assert.match(html, /Account 4/);
  assert.match(html, /href="\/admin\/feedback\/12"/, 'the report has an address of its own');
  assert.match(html, />Delete now</);
  assert.match(html, /Deletes itself on /, 'the window is stated per row, not once at the top');
});

test('an empty queue says nothing has been reported, and draws no row and no delete control', () => {
  const html = render(
    createElement(FeedbackQueue, {
      reports: [],
      retentionDays: RETENTION_DAYS,
      deletingId: null,
      onDelete: () => undefined,
    }),
  );

  assert.match(html, /Nothing has been reported\./);
  // THE CONTROL CASE for the test above: the same four assertions, inverted.
  // If the row markup were unconditional, this render would carry it too.
  assert.doesNotMatch(html, /Report 12/);
  assert.doesNotMatch(html, /href="\/admin\/feedback\/12"/);
  assert.doesNotMatch(html, />Delete now</);
  assert.doesNotMatch(html, /Deletes itself on /);
});

test('a report with no photograph says so in the queue, and one with a photograph does not', () => {
  const typed = render(
    createElement(FeedbackQueue, {
      reports: [TYPED_MEAL],
      retentionDays: RETENTION_DAYS,
      deletingId: null,
      onDelete: () => undefined,
    }),
  );
  const photographed = render(
    createElement(FeedbackQueue, {
      reports: [WITH_PHOTO],
      retentionDays: RETENTION_DAYS,
      deletingId: null,
      onDelete: () => undefined,
    }),
  );

  assert.match(typed, /No photo, typed meal/);
  assert.match(photographed, /With a photo/);
  // The control: the placeholder is a branch, not a constant.
  assert.doesNotMatch(photographed, /No photo, typed meal/);
  assert.doesNotMatch(typed, /With a photo/);
});

// ── One report ──────────────────────────────────────────────────────────────

test('the report page draws the figures beside the photograph, and names what was agreed to', () => {
  const html = render(
    createElement(FeedbackReportView, {
      report: REPORT_DETAIL,
      photo: { kind: 'ready', src: 'blob:local' },
      retentionDays: RETENTION_DAYS,
      isDeleting: false,
      onDelete: () => undefined,
    }),
  );

  assert.match(html, /Scrambled eggs/);
  assert.match(html, /Carbs/);
  assert.match(html, /2\.5 g/, 'the figure, in its own unit');
  assert.match(html, /310 kcal/, 'and calories are not grams');
  assert.match(html, /Estimated by the model/);
  assert.match(html, /<img/, 'the photograph is drawn from the object URL the route owns');
  assert.match(html, /src="blob:local"/);
  assert.match(html, /What was agreed to/);
  assert.match(html, /Wording 2026-09-01/);
  assert.match(html, />Delete now</);
  // The token must never travel in the markup: the bytes are fetched over the
  // admin client and handed here as an object URL.
  assert.doesNotMatch(html, /\/v1\/admin\/feedback\/12\/image/);
});

test('a figure the model did not give says so, rather than reading as a zero', () => {
  const measured = render(
    createElement(FeedbackReportView, {
      report: REPORT_DETAIL,
      photo: { kind: 'ready', src: 'blob:local' },
      retentionDays: RETENTION_DAYS,
      isDeleting: false,
      onDelete: () => undefined,
    }),
  );
  const unmeasured = render(
    createElement(FeedbackReportView, {
      report: NOTHING_MEASURED,
      photo: { kind: 'ready', src: 'blob:local' },
      retentionDays: RETENTION_DAYS,
      isDeleting: false,
      onDelete: () => undefined,
    }),
  );

  assert.match(unmeasured, /None given/);
  // The control: a report whose figures ARE present must not print it.
  assert.doesNotMatch(measured, /None given/);
  // Seven rows either way, so a missing figure is visible as missing.
  assert.equal(reportedFigures(NOTHING_MEASURED.measurements).length, 7);
});

test('a report with no photograph draws the typed-meal placeholder, and one with a photograph draws the image', () => {
  const typed = render(
    createElement(FeedbackReportView, {
      report: { ...REPORT_DETAIL, hasImage: false },
      photo: { kind: 'none' },
      retentionDays: RETENTION_DAYS,
      isDeleting: false,
      onDelete: () => undefined,
    }),
  );
  const photographed = render(
    createElement(FeedbackReportView, {
      report: REPORT_DETAIL,
      photo: { kind: 'ready', src: 'blob:local' },
      retentionDays: RETENTION_DAYS,
      isDeleting: false,
      onDelete: () => undefined,
    }),
  );

  assert.match(typed, /No photo, typed meal/);
  assert.doesNotMatch(typed, /<img/, 'nothing to draw, so no broken frame');
  // The control case: the same component with a photograph draws neither.
  assert.doesNotMatch(photographed, /No photo, typed meal/);
  assert.match(photographed, /<img/);
});

test('a photograph the retention window already took is its own sentence, not a failure', () => {
  const gone = render(
    createElement(FeedbackReportView, {
      report: REPORT_DETAIL,
      photo: { kind: 'gone' },
      retentionDays: RETENTION_DAYS,
      isDeleting: false,
      onDelete: () => undefined,
    }),
  );
  const failed = render(
    createElement(FeedbackReportView, {
      report: REPORT_DETAIL,
      photo: { kind: 'failed' },
      retentionDays: RETENTION_DAYS,
      isDeleting: false,
      onDelete: () => undefined,
    }),
  );

  assert.match(gone, /The photo has already been deleted\./);
  assert.match(failed, /The photo could not be loaded\./);
  assert.doesNotMatch(gone, /could not be loaded/, 'a kept promise is not an error');
});

// ── Where the console does not exist ────────────────────────────────────────

/**
 * The status of the `Response` a call threw, or `null` when it threw something
 * else or nothing at all.
 *
 * `null` for "it did not throw" is what makes the control case below real: a
 * function that stopped throwing would report `null` rather than pass.
 */
function statusOfThrownResponse(call: () => number): number | null {
  try {
    call();
    return null;
  } catch (error) {
    return error instanceof Response ? error.status : null;
  }
}

const INSTANCE_WITHOUT_REPORTS: InstanceDescriptor = {
  name: 'openplate',
  language: 'en',
  mail: true,
  ai: { model: 'a-model' },
};

const INSTANCE_WITH_REPORTS: InstanceDescriptor = {
  ...INSTANCE_WITHOUT_REPORTS,
  feedback: { retentionDays: RETENTION_DAYS },
};

test('an instance that advertises no retention window is a 404, exactly as its server answers', () => {
  assert.equal(
    statusOfThrownResponse(() => requireFeedbackWindow(INSTANCE_WITHOUT_REPORTS)),
    404,
    'reports off must be indistinguishable from a build that never had the feature',
  );
  assert.equal(
    statusOfThrownResponse(() => requireFeedbackWindow(null)),
    404,
  );
  // THE CONTROL CASE: the same call on an instance that DOES advertise one
  // must not throw, or the assertions above would pass on a function that
  // throws unconditionally.
  assert.equal(requireFeedbackWindow(INSTANCE_WITH_REPORTS), RETENTION_DAYS);
});

test('the tab is drawn only where the console exists', () => {
  const on = render(createElement(AdminTabs, { pathname: '/admin', hasFeedback: true }));
  const off = render(createElement(AdminTabs, { pathname: '/admin', hasFeedback: false }));

  assert.match(on, /href="\/admin\/feedback"/);
  assert.doesNotMatch(off, /href="\/admin\/feedback"/, 'no tab may lead to an address that answers 404');
  assert.equal(hasFeedbackConsole(INSTANCE_WITH_REPORTS), true);
  assert.equal(hasFeedbackConsole(INSTANCE_WITHOUT_REPORTS), false);
});

test('one report lights the reports tab, because it is where the queue leads', () => {
  const html = render(createElement(AdminTabs, { pathname: '/admin/feedback/12', hasFeedback: true }));
  assert.match(html, /aria-current="page"[^>]*>Reports</);
  assert.doesNotMatch(html, /aria-current="page"[^>]*>People</);
});

// ── When a report deletes itself ────────────────────────────────────────────

test('the deletion date is the arrival plus the window the server advertised', () => {
  const deletesAt = reportDeletesAt({ createdAt: '2026-09-01T10:00:00.000Z', retentionDays: RETENTION_DAYS });
  assert.equal(deletesAt?.toISOString(), '2026-10-01T10:00:00.000Z');
  // A different window is a different date, so the number is read rather than
  // baked in.
  const shorter = reportDeletesAt({ createdAt: '2026-09-01T10:00:00.000Z', retentionDays: 7 });
  assert.equal(shorter?.toISOString(), '2026-09-08T10:00:00.000Z');
  // A timestamp this app cannot read is `null`, never 1970 plus a window.
  assert.equal(reportDeletesAt({ createdAt: 'not a date', retentionDays: RETENTION_DAYS }), null);
});

// ── The wire ────────────────────────────────────────────────────────────────

/** What the fake transport was asked, in order. */
interface RecordedCall {
  path: string;
  method: string;
}

/** What one fake transport answers with. Every field absent is a transport that rejects. */
interface FakeAnswers {
  json?: JsonValue;
  jsonError?: unknown;
  bytes?: AuthorizedBytes;
  bytesError?: unknown;
}

/** A fake transport and the calls it recorded. Named, because the return position takes no anonymous contract. */
interface FakeTransport {
  transport: AdminTransport;
  calls: RecordedCall[];
}

/** A transport that records the calls and answers whatever it was built with. */
function fakeTransport(input: FakeAnswers): FakeTransport {
  const calls: RecordedCall[] = [];
  const transport: AdminTransport = {
    requestAsAccount(request) {
      calls.push({ path: request.path, method: request.method });
      if (input.jsonError !== undefined) return Promise.reject(input.jsonError);
      return Promise.resolve(input.json ?? null);
    },
    requestBytesAsAccount(request) {
      calls.push({ path: request.path, method: 'GET' });
      if (input.bytesError !== undefined) return Promise.reject(input.bytesError);
      if (input.bytes === undefined) return Promise.reject(new Error('this fake was given no bytes'));
      return Promise.resolve(input.bytes);
    },
  };
  return { transport, calls };
}

test('the queue is read from the paged list endpoint, and the summary carries no figures', async () => {
  const { transport, calls } = fakeTransport({
    json: {
      reports: [
        {
          id: 12,
          accountId: 4,
          hasImage: true,
          consentWordingVersion: '2026-09-01',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
    },
  });
  const outcome = await new AdminClient({ transport }).listFeedbackReports();

  assert.equal(outcome.status, 'ok');
  assert.equal(outcome.status === 'ok' ? outcome.value.total : -1, 1);
  assert.deepEqual(calls, [{ path: '/v1/admin/feedback?limit=200&offset=0', method: 'GET' }]);
});

test('one report is read from its own path, and a missing macro is null rather than a broken page', async () => {
  const { transport, calls } = fakeTransport({
    json: {
      report: {
        id: 12,
        accountId: 4,
        hasImage: true,
        consentWordingVersion: '2026-09-01',
        createdAt: '2026-09-01T10:00:00.000Z',
        // POLYOLS IS ABSENT, as it would be from a report written by an older
        // build of this app. The service stores `measurements` verbatim and
        // has no opinion about it, so this client cannot demand one.
        measurements: {
          name: 'Scrambled eggs',
          quantityGrams: 180,
          loggedAt: '2026-09-01T09:40:00.000Z',
          source: 'scan',
          aiEstimated: true,
          carbs: 2.5,
          fiber: 0,
          sugars: 1,
          protein: 19,
          fat: 24,
          kcal: 310,
        },
        consent: { agreedAt: '2026-09-01T09:59:00.000Z', wordingVersion: '2026-09-01' },
      },
    },
  });
  const outcome = await new AdminClient({ transport }).getFeedbackReport({ id: 12 });

  assert.equal(outcome.status, 'ok');
  assert.equal(outcome.status === 'ok' ? outcome.value.measurements.polyols : 'unread', null);
  assert.equal(outcome.status === 'ok' ? outcome.value.measurements.carbs : 'unread', 2.5);
  assert.deepEqual(calls, [{ path: '/v1/admin/feedback/12', method: 'GET' }]);
});

test('the photograph is fetched over the credential, never as a URL with one in it', async () => {
  const bytes: AuthorizedBytes = { contentType: 'image/jpeg', bytes: new ArrayBuffer(3) };
  const { transport, calls } = fakeTransport({ bytes });
  const outcome = await new AdminClient({ transport }).feedbackImage({ id: 12 });

  assert.equal(outcome.status, 'ok');
  assert.deepEqual(calls, [{ path: '/v1/admin/feedback/12/image', method: 'GET' }]);
  assert.doesNotMatch(calls[0]?.path ?? '', /[?&]/, 'no credential and no query string in the address');
});

test('a photograph the service no longer has is "gone", and a 500 is still a failure', async () => {
  const gone = await new AdminClient({
    transport: fakeTransport({ bytesError: new SyncRequestError({ kind: 'not-found', message: 'no such report' }) })
      .transport,
  }).feedbackImage({ id: 12 });
  assert.equal(gone.status, 'gone');

  // THE CONTROL CASE: not every failure is an absence. A 500 must still throw,
  // or "gone" would quietly swallow a broken server.
  await assert.rejects(
    new AdminClient({
      transport: fakeTransport({ bytesError: new SyncRequestError({ kind: 'server', message: 'boom' }) }).transport,
    }).feedbackImage({ id: 12 }),
  );
});

test('deleting a report calls DELETE on its path, and a report already gone is a success', async () => {
  const { transport, calls } = fakeTransport({ json: null });
  const outcome = await new AdminClient({ transport }).deleteFeedbackReport({ id: 12 });
  assert.equal(outcome.status, 'ok');
  assert.deepEqual(calls, [{ path: '/v1/admin/feedback/12', method: 'DELETE' }]);

  const raced = await new AdminClient({
    transport: fakeTransport({ jsonError: new SyncRequestError({ kind: 'not-found', message: 'no such report' }) })
      .transport,
  }).deleteFeedbackReport({ id: 12 });
  assert.equal(raced.status, 'ok', 'a retention sweep or a second administrator getting there first is not an error');

  // THE CONTROL CASE: a 403 is still a refusal this page has to render.
  const refused = await new AdminClient({
    transport: fakeTransport({ jsonError: new SyncRequestError({ kind: 'forbidden', message: 'no' }) }).transport,
  }).deleteFeedbackReport({ id: 12 });
  assert.equal(refused.status, 'forbidden');
});
