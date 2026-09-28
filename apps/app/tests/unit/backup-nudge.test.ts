/**
 * The backup nudge: when it speaks, and the one claim it must never make.
 *
 * The decision is pure, so most of this file is a table. The last two suites
 * RENDER, for the reason `device-only-managed-copy.test.ts` renders: a source
 * grep proves a question was asked, never that its answer reaches the screen.
 * The banner reads the instance policy through the root loader's public
 * config, which is a channel only a render exercises.
 *
 * WHAT THE BROWSER TIER COVERS INSTEAD. `tests/e2e/backup-nudge.spec.ts` drives
 * the open-instance half on a real device: a diary past the threshold is
 * nudged, the same diary signed in to sync is not, and the banner is never
 * drawn for the frames a resume takes. That tier runs with no `INSTANCE_MODE`,
 * so the managed half is only checkable here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import {
  BACKUP_NUDGE_THRESHOLD_DAYS,
  hasServerCopyOfTheDiary,
  shouldShowBackupNudge,
} from '../../app/lib/backup-nudge';
import { computeDaysSinceFirstData } from '../../app/lib/local-store/backup';
import { BackupNudgeBanner } from '../../app/components/backup-nudge-banner';
import enCommon from '../../app/i18n/locales/en/common.json';
import type { PublicConfig } from '../../app/config/public-config';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('shouldShowBackupNudge — device that has exported before', () => {
  it('is false at 0 days since a real export', () => {
    assert.equal(
      shouldShowBackupNudge({ daysSinceExport: 0, daysSinceFirstData: 900, hasData: true, hasServerCopy: false }),
      false,
    );
  });

  it('is false one day after an export, however old the data is', () => {
    assert.equal(
      shouldShowBackupNudge({ daysSinceExport: 1, daysSinceFirstData: 900, hasData: true, hasServerCopy: false }),
      false,
    );
  });

  it('is false below the threshold', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS - 1,
        daysSinceFirstData: 900,
        hasData: true,
        hasServerCopy: false,
      }),
      false,
    );
  });

  it('is true exactly at the threshold', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS,
        daysSinceFirstData: 900,
        hasData: true,
        hasServerCopy: false,
      }),
      true,
    );
  });

  it('is true well past the threshold (20 days since export)', () => {
    assert.equal(
      shouldShowBackupNudge({ daysSinceExport: 20, daysSinceFirstData: 900, hasData: true, hasServerCopy: false }),
      true,
    );
  });
});

describe('shouldShowBackupNudge — device that has NEVER exported', () => {
  it('is false when the data is only a day old — a first-week user is not nagged', () => {
    assert.equal(
      shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: 1, hasData: true, hasServerCopy: false }),
      false,
    );
  });

  it('is false one day short of the threshold', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: null,
        daysSinceFirstData: BACKUP_NUDGE_THRESHOLD_DAYS - 1,
        hasData: true,
        hasServerCopy: false,
      }),
      false,
    );
  });

  it('is true exactly at the threshold — the same bar an exported device is held to', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: null,
        daysSinceFirstData: BACKUP_NUDGE_THRESHOLD_DAYS,
        hasData: true,
        hasServerCopy: false,
      }),
      true,
    );
  });

  it('is true when the data is 20 days old', () => {
    assert.equal(
      shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: 20, hasData: true, hasServerCopy: false }),
      true,
    );
  });

  // Case 5 in `shouldShowBackupNudge`'s doc. `firstDataAt` only started being
  // written in M123, so a device in the field today can hold months of data
  // and no marker. Its data is therefore OLDER than anything the marker can
  // measure, not newer — and the costs are asymmetric: nudging wrongly costs a
  // dismissible banner, staying quiet wrongly costs the user everything with
  // no warning. So a missing marker with data present nudges.
  it('is true when the marker is missing but data is present (pre-marker device)', () => {
    assert.equal(
      shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: null, hasData: true, hasServerCopy: false }),
      true,
    );
  });
});

describe('shouldShowBackupNudge — device with nothing to lose', () => {
  it('is false with no data and no marker, never exported (genuinely new device)', () => {
    assert.equal(
      shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: null, hasData: false, hasServerCopy: false }),
      false,
    );
  });

  it('is false with no data even when the marker is old (data was deleted, nothing left to back up)', () => {
    assert.equal(
      shouldShowBackupNudge({ daysSinceExport: null, daysSinceFirstData: 900, hasData: false, hasServerCopy: false }),
      false,
    );
  });

  it('is false with no data even long past a real export', () => {
    assert.equal(
      shouldShowBackupNudge({
        daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS + 30,
        daysSinceFirstData: null,
        hasData: false,
        hasServerCopy: false,
      }),
      false,
    );
  });
});

////////////////////////////////////////////////////////////////////////////////
// A server already holds a copy
////////////////////////////////////////////////////////////////////////////////

/** Every input shape that nudges when nothing holds a copy. The three cases in the rule's doc. */
const NUDGING_INPUTS = [
  { daysSinceExport: BACKUP_NUDGE_THRESHOLD_DAYS, daysSinceFirstData: 900, hasData: true },
  { daysSinceExport: null, daysSinceFirstData: BACKUP_NUDGE_THRESHOLD_DAYS, hasData: true },
  { daysSinceExport: null, daysSinceFirstData: null, hasData: true },
] as const;

describe('shouldShowBackupNudge — a server already holds a copy', () => {
  // EACH CASE CARRIES ITS OWN CONTROL, in the same loop: the identical input
  // with `hasServerCopy: false` must nudge. Without it, a rule that returned
  // `false` for everything would pass this suite.
  it('silences every input that would otherwise nudge', () => {
    for (const input of NUDGING_INPUTS) {
      const described = JSON.stringify(input);
      assert.equal(
        shouldShowBackupNudge({ ...input, hasServerCopy: false }),
        true,
        `the control must nudge: ${described}`,
      );
      assert.equal(shouldShowBackupNudge({ ...input, hasServerCopy: true }), false, described);
    }
  });

  it('does not make a quiet device speak: no data stays silent either way', () => {
    const empty = { daysSinceExport: null, daysSinceFirstData: 900, hasData: false } as const;
    assert.equal(shouldShowBackupNudge({ ...empty, hasServerCopy: false }), false);
    assert.equal(shouldShowBackupNudge({ ...empty, hasServerCopy: true }), false);
  });
});

describe('hasServerCopyOfTheDiary', () => {
  // THE BASE, and the control for the three below: an open instance, no
  // session, nothing being reopened. This is the device the banner was written
  // for, and its answer has to stay `false` or the nudge is dead everywhere.
  it('is false on an open instance with no session', () => {
    assert.equal(
      hasServerCopyOfTheDiary({ serverHoldsTheDiary: false, isSessionResuming: false, isSignedIn: false }),
      false,
    );
  });

  it('is true on a managed instance, whatever this device has done', () => {
    assert.equal(
      hasServerCopyOfTheDiary({ serverHoldsTheDiary: true, isSessionResuming: false, isSignedIn: false }),
      true,
    );
  });

  it('is true for a signed-in device on an open instance', () => {
    assert.equal(
      hasServerCopyOfTheDiary({ serverHoldsTheDiary: false, isSessionResuming: false, isSignedIn: true }),
      true,
    );
  });

  // The flash rule. A device reopening a session has `account === null` for a
  // moment, and reading that as "signed out" would draw the banner and take it
  // away again, which is the false sentence shown to exactly the wrong people.
  it('is true while a session is still being reopened', () => {
    assert.equal(
      hasServerCopyOfTheDiary({ serverHoldsTheDiary: false, isSessionResuming: true, isSignedIn: false }),
      true,
    );
  });
});

////////////////////////////////////////////////////////////////////////////////
// The banner on the screen
////////////////////////////////////////////////////////////////////////////////

/**
 * A managed instance always has a sync server (`isManagedInstance` refuses to
 * boot without one), so the two move together here, as they do in
 * `device-only-managed-copy.test.ts`.
 */
function publicConfig(managed: boolean): PublicConfig {
  return { syncServerUrl: 'https://sync.openplate.test', analytics: null, instancePreset: null, managed, foodDbBackfill: false };
}

/**
 * The banner, rendered under a router whose ROOT loader supplies the public
 * config, which is the channel `useInstancePolicy()` reads.
 *
 * The session is the one `useSyncExternalStore` hands a static render, a
 * constant signed-out snapshot with nothing resuming, so the instance policy
 * is the only thing that differs between these two renders.
 *
 * @param managed - the instance mode this render's public config reports.
 * @returns the markup, which is empty when the banner decided to stay quiet.
 */
function renderBanner(managed: boolean): string {
  const config = publicConfig(managed);
  const banner = withI18n(
    createElement(BackupNudgeBanner, { daysSinceExport: null, daysSinceFirstData: 900, hasData: true }),
  );
  const router = createMemoryRouter(
    [
      {
        id: 'root',
        path: '/',
        loader: () => ({ publicConfig: config }),
        children: [{ index: true, element: banner }],
      },
    ],
    { initialEntries: ['/'], hydrationData: { loaderData: { root: { publicConfig: config } } } },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe('BackupNudgeBanner', () => {
  const OPEN = renderBanner(false);
  const MANAGED = renderBanner(true);

  it('speaks on an open instance whose device has no session', () => {
    assert.ok(OPEN.includes('data-slot="backup-nudge"'), OPEN.slice(0, 400));
    // WHICH banner, not just an element: the sentence under test is the one
    // that claims the diary lives on one device only.
    assert.ok(OPEN.includes(enCommon.banners.backupNeverExported), OPEN.slice(0, 400));
  });

  it('stays quiet on a managed instance, on the same device and the same diary', () => {
    assert.ok(!MANAGED.includes('data-slot="backup-nudge"'), MANAGED.slice(0, 400));
    assert.ok(!MANAGED.includes(enCommon.banners.backupNeverExported), MANAGED.slice(0, 400));
  });
});

describe('computeDaysSinceFirstData', () => {
  it('is null when the device never held data (no marker)', () => {
    assert.equal(computeDaysSinceFirstData(null, Date.UTC(2026, 0, 20)), null);
  });

  it('floors to whole days, matching computeDaysSinceExport', () => {
    const now = Date.UTC(2026, 0, 20);
    assert.equal(computeDaysSinceFirstData(now - 20 * DAY_MS, now), 20);
    assert.equal(computeDaysSinceFirstData(now - (20 * DAY_MS - 1), now), 19);
  });

  it('is 0 for data created moments ago', () => {
    const now = Date.UTC(2026, 0, 20);
    assert.equal(computeDaysSinceFirstData(now - 1000, now), 0);
  });

  it('clamps a backwards clock to 0 rather than reporting negative days', () => {
    const now = Date.UTC(2026, 0, 20);
    assert.equal(computeDaysSinceFirstData(now + 5 * DAY_MS, now), 0);
  });
});
