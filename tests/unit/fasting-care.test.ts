/**
 * Unit tests for `#app/models/fasting-care`, the two decisions `/fasting`
 * makes before it lets a fast start.
 *
 * What this file pins, in one sentence each:
 *
 * - **The care sheet fires at 24 h, not at 23 h**, and never again once it has
 *   been acknowledged. An off-by-one here either nags somebody on a 23 h fast
 *   or, far worse, skips the sheet for the person it was written for.
 * - **The pregnancy filter really removes presets**, with a control that a
 *   profile saying nothing still gets all seven. A filter that quietly returns
 *   the whole list passes every "renders a chip row" assertion.
 * - **The cap is not decoration**: the custom-hours ceiling moves with the
 *   filter, so the hidden presets cannot be reached by typing the number.
 * - **A routine occurrence is tomorrow once its minute has passed**, the same
 *   boundary `defaultPlannedStartLocal` uses.
 * - **Every preset label key resolves in the shipped English catalog**,
 *   including the three ids with a colon in them, which i18next reads as a
 *   namespace separator unless it is told not to.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FAST_CARE_MAX_HOURS,
  FAST_EXTENDED_TARGET_MS,
  isAllowedCustomHours,
  isCareStatus,
  maxCustomHoursForStatus,
  needsCareSheet,
  nextRoutineOccurrenceMs,
  presetsForStatus,
  protocolLabelKey,
} from '../../app/models/fasting-care';
import { FAST_MAX_CUSTOM_HOURS, FAST_PROTOCOLS } from '../../app/models/fasting';

const HOUR = 3_600_000;
const ACKNOWLEDGED_AT = 1_750_000_000_000;

describe('needsCareSheet', () => {
  it('does not fire below 24 hours', () => {
    assert.equal(needsCareSheet({ targetMs: 23 * HOUR, extendedAcknowledgedAt: null }), false);
  });

  it('fires at exactly 24 hours', () => {
    assert.equal(needsCareSheet({ targetMs: 24 * HOUR, extendedAcknowledgedAt: null }), true);
    assert.equal(FAST_EXTENDED_TARGET_MS, 24 * HOUR);
  });

  it('fires for anything longer', () => {
    assert.equal(needsCareSheet({ targetMs: 72 * HOUR, extendedAcknowledgedAt: null }), true);
  });

  it('never fires again once acknowledged', () => {
    assert.equal(needsCareSheet({ targetMs: 24 * HOUR, extendedAcknowledgedAt: ACKNOWLEDGED_AT }), false);
    assert.equal(needsCareSheet({ targetMs: 72 * HOUR, extendedAcknowledgedAt: ACKNOWLEDGED_AT }), false);
  });
});

describe('isCareStatus', () => {
  it('is true for pregnant and lactating only', () => {
    assert.equal(isCareStatus('pregnant'), true);
    assert.equal(isCareStatus('lactating'), true);
    assert.equal(isCareStatus('none'), false);
    assert.equal(isCareStatus(null), false);
    assert.equal(isCareStatus(undefined), false);
  });
});

describe('presetsForStatus', () => {
  it('offers all seven named presets when nothing applies', () => {
    // The CONTROL. Without it a filter that dropped everything, or one that
    // never filtered at all, would still pass the pregnancy case below.
    assert.equal(presetsForStatus('none').length, 7);
    assert.deepEqual(
      presetsForStatus('none').map((protocol) => protocol.id),
      FAST_PROTOCOLS.map((protocol) => protocol.id),
    );
  });

  it('keeps only the windows at or under 16 fasting hours while pregnant', () => {
    const presets = presetsForStatus('pregnant');
    assert.ok(presets.length > 0, 'the picker must still offer a choice');
    assert.ok(presets.length < FAST_PROTOCOLS.length, 'the filter removed nothing');
    for (const protocol of presets) {
      assert.ok(
        protocol.fastingHours <= FAST_CARE_MAX_HOURS,
        `${protocol.id} is ${protocol.fastingHours} h, past the ${FAST_CARE_MAX_HOURS} h ceiling`,
      );
    }
  });

  it('treats lactating exactly as pregnant', () => {
    assert.deepEqual(
      presetsForStatus('lactating').map((protocol) => protocol.id),
      presetsForStatus('pregnant').map((protocol) => protocol.id),
    );
  });
});

describe('the custom-hours ceiling', () => {
  it('moves with the filter, so a hidden preset cannot be typed instead', () => {
    assert.equal(maxCustomHoursForStatus('none'), FAST_MAX_CUSTOM_HOURS);
    assert.equal(maxCustomHoursForStatus('pregnant'), FAST_CARE_MAX_HOURS);
    assert.equal(maxCustomHoursForStatus('lactating'), FAST_CARE_MAX_HOURS);
  });

  it('accepts 24 h for an ordinary profile and refuses it for a care profile', () => {
    assert.equal(isAllowedCustomHours(24, 'none'), true);
    assert.equal(isAllowedCustomHours(24, 'pregnant'), false);
    assert.equal(isAllowedCustomHours(16, 'pregnant'), true);
  });

  it('still refuses what the model already refused', () => {
    assert.equal(isAllowedCustomHours(0, 'none'), false);
    assert.equal(isAllowedCustomHours(16.5, 'none'), false);
    assert.equal(isAllowedCustomHours(FAST_MAX_CUSTOM_HOURS + 1, 'none'), false);
  });
});

/** 2026-09-12 at the given local hour and minute, built in the runtime zone like the widget is. */
function localAt(hours: number, minutes: number): number {
  return new Date(2026, 8, 12, hours, minutes, 0, 0).getTime();
}

describe('nextRoutineOccurrenceMs', () => {
  it('picks today when the minute is still ahead', () => {
    const at = nextRoutineOccurrenceMs({ nowMs: localAt(9, 0), routineStartMinute: 20 * 60 });
    assert.equal(at, localAt(20, 0));
  });

  it('rolls to tomorrow once the minute has passed', () => {
    const at = nextRoutineOccurrenceMs({ nowMs: localAt(21, 30), routineStartMinute: 20 * 60 });
    assert.equal(at, localAt(20, 0) + 24 * HOUR);
  });

  it('rolls to tomorrow at exactly the minute, so a schedule is never for right now', () => {
    const at = nextRoutineOccurrenceMs({ nowMs: localAt(20, 0), routineStartMinute: 20 * 60 });
    assert.equal(at, localAt(20, 0) + 24 * HOUR);
  });

  it('reads midnight and the last minute of the day', () => {
    assert.equal(nextRoutineOccurrenceMs({ nowMs: localAt(9, 0), routineStartMinute: 0 }), localAt(0, 0) + 24 * HOUR);
    assert.equal(nextRoutineOccurrenceMs({ nowMs: localAt(9, 0), routineStartMinute: 1439 }), localAt(23, 59));
  });
});

/** The shipped English preset labels, read from disk rather than through i18next. */
function loadEnglishProtocolLabels(): Record<string, string> {
  const url = new URL('../../app/i18n/locales/en/common.json', import.meta.url);
  const catalog = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  return catalog.fasting.plan.protocol;
}

describe('the preset labels', () => {
  it('has a label in the catalog for every named preset, colons and all', () => {
    const labels = loadEnglishProtocolLabels();
    for (const protocol of FAST_PROTOCOLS) {
      const key = protocolLabelKey(protocol.id);
      assert.equal(key, `fasting.plan.protocol.${protocol.id}`);
      const label = labels[protocol.id];
      assert.notEqual(label, undefined, `no English label for ${protocol.id}`);
      assert.notEqual(label, '', `empty English label for ${protocol.id}`);
    }
  });

  it('has no label for a preset this build does not ship', () => {
    // The control: the lookup above would pass vacuously if the catalog held
    // a label for everything.
    assert.equal(loadEnglishProtocolLabels()['96h'], undefined);
  });
});
