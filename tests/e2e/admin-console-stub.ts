/**
 * An administrator's console, routed for the browser tier.
 *
 * ── Why routed and not served ────────────────────────────────────────────
 *
 * The fake sync service implements no admin API, and its one account is a
 * member (`tests/integration/fake-sync-service.ts`). So, as in
 * `date-language.spec.ts`, the two auth answers that carry the account are
 * passed through with `role` rewritten to `admin`, and every `/v1/admin/*` read
 * the console makes is answered here. Nothing on the shared fixture row
 * changes, so no later spec meets an administrator.
 *
 * `/health` is passed through too, with a reports window added, because the
 * fifth tab is drawn only where the instance advertises one. The widest bar is
 * the one a layout check has to see.
 *
 * ── The bodies are real wire shapes, with long values on purpose ─────────
 *
 * Every body below parses through the app's own schemas (`admin-wire.ts`), so
 * a stub that drifted from the wire would fail as a broken page rather than
 * pass as an empty one. The values are chosen to be wide: a long name and a
 * long address, a suspended person, a second administrator, four digit
 * counts, and activity windows of whatever length the page asks for.
 *
 * ── A request this file has no answer for is recorded, not guessed ───────
 *
 * It gets a 404 and its method and path go into `unanswered`, which a spec
 * requires to be empty. A console that started calling a new endpoint would
 * otherwise draw its failure card here and still pass the layout checks.
 */
import type { Page, Route } from '@playwright/test';
import { z } from 'zod';

import { ADMIN_API_PREFIX } from '../../app/lib/admin/admin-wire';
import { AUTH_API_PREFIX } from '../../app/lib/sync/engine/client/auth-wire';
import { E2E_ACCOUNT_EMAIL, E2E_SYNC_SERVER_URL } from './env';

/** What the routed console says, and what it saw. Mutate the gates between loads. */
export interface AdminConsoleStub {
  /** The signed-in account's id, read off the first auth answer that carries one. `null` until sign-in. */
  selfId: number | null;
  /** Every admin request with no answer here, as `METHOD /path`. A spec requires this to stay empty. */
  unanswered: string[];
  /** Holds every `/health` answer until it settles. Left out, `/health` answers at once. */
  healthGate?: Promise<void>;
  /** Holds every `/v1/admin/stats` answer until it settles. Left out, the counts answer at once. */
  statsGate?: Promise<void>;
}

/** A fresh stub: nobody signed in yet, nothing unanswered, no gates. */
export function adminConsoleStub(): AdminConsoleStub {
  return { selfId: null, unanswered: [] };
}

/** The reports window the routed `/health` advertises, in days. Any positive whole number draws the tab. */
const REPORT_RETENTION_DAYS = 30;

/** How many days a person's own page asks for. The service answers its retention window. */
const PERSON_WINDOW_DAYS = 30;

/** The longest activity window answered. The page offers 7, 30 and 90; a longer ask is answered with 90, as a service caps it. */
const LONGEST_WINDOW_DAYS = 90;

/** Milliseconds in one UTC day. */
const DAY_MS = 86_400_000;

/** An instant everybody below was created at. Noon UTC, so no time zone reads another day. */
const CREATED_AT = '2026-06-01T12:00:00.000Z';

/** The long address on the widest person. Exported so a spec can wait for it to be drawn. */
export const LONG_PERSON_EMAIL = 'maximiliane.musterfrau-schoenberger@example.invalid';

/** The long address on the widest pending invitation. Exported for the same reason. */
export const LONG_INVITE_EMAIL = 'konstantin.alexandropoulos-weatherby@example.invalid';

/** The id of the widest person, whose own page a spec opens. */
export const LONG_PERSON_ID = 9001;

/** One account as `accountViewSchema` reads it, every field present. */
interface AccountFixture {
  id: number;
  email: string;
  displayName: string | null;
  role: 'admin' | 'member';
  dailyAiLimit: number;
  aiUsedToday: number;
  allowanceExpiresAt: string | null;
  suspendedAt: string | null;
  invitesLeft: number | null;
  trialScans: { granted: number; left: number } | null;
  createdAt: string;
  lastSeenAt: string | null;
}

/** Everybody but the signed-in administrator, whose row is added with the id the session carries. */
const OTHER_PEOPLE: readonly AccountFixture[] = [
  {
    id: LONG_PERSON_ID,
    email: LONG_PERSON_EMAIL,
    displayName: 'Maximiliane Musterfrau-Schönberger',
    role: 'member',
    dailyAiLimit: 2000,
    aiUsedToday: 1987,
    allowanceExpiresAt: '2026-12-31T12:00:00.000Z',
    suspendedAt: null,
    invitesLeft: 3,
    trialScans: { granted: 10, left: 3 },
    createdAt: CREATED_AT,
    lastSeenAt: '2026-09-20T12:00:00.000Z',
  },
  {
    id: 9002,
    email: 'suspended.person@example.invalid',
    displayName: null,
    role: 'member',
    dailyAiLimit: 0,
    aiUsedToday: 0,
    allowanceExpiresAt: null,
    suspendedAt: '2026-09-01T12:00:00.000Z',
    invitesLeft: 0,
    trialScans: null,
    createdAt: CREATED_AT,
    lastSeenAt: null,
  },
  {
    id: 9003,
    email: 'second.administrator@example.invalid',
    displayName: 'Second administrator',
    role: 'admin',
    dailyAiLimit: 500,
    aiUsedToday: 12,
    allowanceExpiresAt: null,
    suspendedAt: null,
    invitesLeft: null,
    trialScans: null,
    createdAt: CREATED_AT,
    lastSeenAt: '2026-09-23T12:00:00.000Z',
  },
];

/** The signed-in administrator's own row. */
function selfAccount(id: number): AccountFixture {
  return {
    id,
    email: E2E_ACCOUNT_EMAIL,
    displayName: null,
    role: 'admin',
    dailyAiLimit: 200,
    aiUsedToday: 7,
    allowanceExpiresAt: null,
    suspendedAt: null,
    invitesLeft: null,
    trialScans: null,
    createdAt: CREATED_AT,
    lastSeenAt: '2026-09-23T12:00:00.000Z',
  };
}

/** Everybody the list shows. The administrator's own row only once the session has named them. */
function everybody(stub: AdminConsoleStub): AccountFixture[] {
  return stub.selfId === null ? [...OTHER_PEOPLE] : [selfAccount(stub.selfId), ...OTHER_PEOPLE];
}

/** Two pending invitations, one of them an administrator's with a long address. */
const PENDING_INVITES = [
  {
    id: 501,
    email: LONG_INVITE_EMAIL,
    displayName: 'Konstantin Alexandropoulos-Weatherby',
    role: 'admin',
    dailyAiLimit: 2000,
    expiresAt: '2026-12-31T12:00:00.000Z',
    status: 'pending',
    createdAt: CREATED_AT,
    redeemedAccountId: null,
  },
  {
    id: 502,
    email: 'short@example.invalid',
    displayName: null,
    role: 'member',
    dailyAiLimit: 0,
    expiresAt: '2026-12-31T12:00:00.000Z',
    status: 'pending',
    createdAt: CREATED_AT,
    redeemedAccountId: null,
  },
];

/** Two reports, one with a photograph and one without, so both lines of the queue row are drawn. */
const REPORTS = [
  {
    id: 4711,
    accountId: LONG_PERSON_ID,
    hasImage: true,
    consentWordingVersion: '1',
    createdAt: '2026-09-20T12:00:00.000Z',
  },
  { id: 4712, accountId: 9003, hasImage: false, consentWordingVersion: '1', createdAt: '2026-09-21T12:00:00.000Z' },
];

/** Four digit counts, the widest the cells are likely to meet. */
const STATS = { accounts: 1234, admins: 2, pendingInvites: 2, aiRequestsToday: 1987 };

/** `YYYY-MM-DD` for the UTC day `daysAgo` before today. */
function dayKey(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** A window of `days` days ending today, in order, every count between 0 and 4 so every shade is drawn. */
function activityWindow(input: { days: number; seed: number }) {
  const days = Array.from({ length: input.days }, (_, index) => ({
    day: dayKey(input.days - 1 - index),
    count: (index + input.seed) % 5,
  }));
  return { window: { days: input.days, fromDay: dayKey(input.days - 1), toDay: dayKey(0) }, days };
}

/** The first page of a list, and nothing after it: the client stops once it holds `total` items. */
function firstPageOnly<T>(input: { items: readonly T[]; offset: number }): T[] {
  return input.offset === 0 ? [...input.items] : [];
}

/** The whole-number query parameter, or the fallback when it is absent or not a number. */
function numberParam(input: { url: URL; name: string; fallback: number }): number {
  const parsed = Number(input.url.searchParams.get(input.name));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : input.fallback;
}

/** `GET /v1/admin/accounts/:id` and `GET /v1/admin/accounts/:id/activity`. */
const PERSON_PATH = /^\/accounts\/(\d+)(\/activity)?$/u;

/**
 * Answers one `/v1/admin/*` request, or records it as unanswered.
 *
 * @param route - the intercepted request.
 * @param stub - what the console says.
 */
async function answerAdmin(route: Route, stub: AdminConsoleStub): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.slice(ADMIN_API_PREFIX.length);
  const offset = numberParam({ url, name: 'offset', fallback: 0 });
  const people = everybody(stub);

  if (request.method() === 'GET' && path === '/stats') {
    await stub.statsGate;
    return route.fulfill({ json: { stats: STATS } });
  }
  if (request.method() === 'GET' && path === '/accounts') {
    return route.fulfill({ json: { accounts: firstPageOnly({ items: people, offset }), total: people.length } });
  }
  if (request.method() === 'GET' && path === '/activity') {
    const days = Math.min(numberParam({ url, name: 'days', fallback: 7 }), LONGEST_WINDOW_DAYS);
    const rows = people.map((person, seed) => ({ accountId: person.id, days: activityWindow({ days, seed }).days }));
    return route.fulfill({
      json: {
        window: activityWindow({ days, seed: 0 }).window,
        accounts: firstPageOnly({ items: rows, offset }),
        total: rows.length,
      },
    });
  }
  if (request.method() === 'GET' && path === '/invites') {
    return route.fulfill({
      json: { invites: firstPageOnly({ items: PENDING_INVITES, offset }), total: PENDING_INVITES.length },
    });
  }
  if (request.method() === 'GET' && path === '/feedback') {
    return route.fulfill({ json: { reports: firstPageOnly({ items: REPORTS, offset }), total: REPORTS.length } });
  }
  const person = PERSON_PATH.exec(path);
  const found = person === null ? undefined : people.find((candidate) => candidate.id === Number(person[1]));
  if (request.method() === 'GET' && found !== undefined && person?.[2] === undefined) {
    return route.fulfill({ json: { account: found } });
  }
  if (request.method() === 'GET' && found !== undefined) {
    const strip = activityWindow({ days: PERSON_WINDOW_DAYS, seed: found.id });
    return route.fulfill({ json: { accountId: found.id, lastSeenAt: found.lastSeenAt, ...strip } });
  }

  stub.unanswered.push(`${request.method()} ${ADMIN_API_PREFIX}${path}`);
  return route.fulfill({ status: 404, json: { error: 'not routed by admin-console-stub.ts' } });
}

/** An auth answer that carries an account. LOOSE, so every other field reaches the app untouched. */
const AUTH_ANSWER_WITH_ACCOUNT = z.looseObject({ account: z.looseObject({ id: z.number().int() }) });

/** The handshake, loose for the same reason. */
const HEALTH_ANSWER = z.looseObject({ instance: z.looseObject({}) });

/**
 * Routes the role, the handshake and every admin read. Install it before the first navigation.
 *
 * @param page - the page, before it has navigated.
 * @param stub - what the console says, read per request.
 */
export async function routeAdminConsole(page: Page, stub: AdminConsoleStub): Promise<void> {
  for (const path of ['login', 'account']) {
    await page.route(`${E2E_SYNC_SERVER_URL}${AUTH_API_PREFIX}/${path}`, async (route) => {
      const response = await route.fetch();
      const body = response.ok() ? AUTH_ANSWER_WITH_ACCOUNT.safeParse(await response.json()) : null;
      if (body === null || !body.success) return route.fulfill({ response });
      stub.selfId = body.data.account.id;
      return route.fulfill({ response, json: { ...body.data, account: { ...body.data.account, role: 'admin' } } });
    });
  }

  await page.route(`${E2E_SYNC_SERVER_URL}/health`, async (route) => {
    await stub.healthGate;
    const response = await route.fetch();
    const body = response.ok() ? HEALTH_ANSWER.safeParse(await response.json()) : null;
    if (body === null || !body.success) return route.fulfill({ response });
    return route.fulfill({
      response,
      json: { ...body.data, instance: { ...body.data.instance, feedback: { retentionDays: REPORT_RETENTION_DAYS } } },
    });
  });

  await page.route(
    (url) => url.href.startsWith(`${E2E_SYNC_SERVER_URL}${ADMIN_API_PREFIX}/`),
    (route) => answerAdmin(route, stub),
  );
}
