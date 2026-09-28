/**
 * The fasting settings page (M216): the routine schema, the patch it produces,
 * the care line, and the hub row that prints the routine back.
 *
 * Four claims, none of them "the JSX was typed":
 *
 *  1. THE SCHEMA REFUSES WHAT THE STORE CANNOT HOLD. `routineStartMinute` is a
 *     minute-of-day (0..1439) and `routineCustomHours` is a whole number of
 *     hours the model accepts, so "24:00" and "73" are refused at the form
 *     rather than written and rendered as a routine nobody can act on. Each
 *     rejection has the neighbouring accepted value as its control.
 *  2. "NONE" CLEARS ALL THREE ROUTINE FIELDS. A start hour with no window
 *     behind it preselects nothing and offers a one-tap start of nothing, so
 *     the patch drops it with the window. The control is the same call with a
 *     window chosen, which keeps the hour.
 *  3. THE CARE LINE SAYS WHICH OF THE TWO THINGS IS TRUE. Acknowledged and
 *     pending are rendered both ways round, so an assertion cannot pass by
 *     matching a string the card always prints.
 *  4. THE HUB ROW READS THE LIVE ROUTINE. Window plus hour, window alone, and
 *     nothing at all, plus the in-flight read that must print no line rather
 *     than a wrong one.
 *
 * Every expected sentence comes out of the SHIPPED English catalog, so this
 * file says nothing about German and a renamed key fails here instead of
 * rendering `settings.fasting.saved` to a person.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import i18next from '../../app/i18n/i18n';
import { withI18n } from './trends-i18n-harness';
import enCommon from '../../app/i18n/locales/en/common.json';
import { FAST_PROTOCOLS } from '../../app/models/fasting';
import type { LocalFastingSettings } from '../../app/lib/local-store/schema';
import {
  FastingCareCard,
  ROUTINE_CHOICE_IDS,
  fastingRoutineLabel,
  fastingRoutinePatch,
  fastingRowStatus,
  formatRoutineMinute,
  makeFastingRoutineSchema,
} from '../../app/routes/settings.fasting';

/** The REAL catalog: the sentences below are resolved, not transcribed. */
const t = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) =>
  i18next.t(key, params ?? {});

const schema = makeFastingRoutineSchema(t);

/** A stored record with no routine and no acknowledgement, the starting point every case overrides. */
const NOTHING_SET: LocalFastingSettings = {
  routineProtocolId: null,
  routineStartMinute: null,
  routineCustomHours: null,
  extendedAcknowledgedAt: null,
  updatedAt: 0,
};

function settingsWith(stored: Partial<LocalFastingSettings>): LocalFastingSettings {
  return { ...NOTHING_SET, ...stored };
}

/** One submission, in the string shape a form actually posts. */
function submission(fields: { routineProtocolId: string; routineCustomHours?: string; routineStartMinute?: string }) {
  return {
    routineProtocolId: fields.routineProtocolId,
    routineCustomHours: fields.routineCustomHours ?? '',
    routineStartMinute: fields.routineStartMinute ?? '',
  };
}

/** Every message the parse reported, flattened, so a test can name the sentence it expects. */
function messagesOf(result: ReturnType<typeof schema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

/** The offered answers, widened to strings so a membership check reads plainly. */
const routineChoices: readonly string[] = ROUTINE_CHOICE_IDS;

describe('the routine chips offer every window the model knows', () => {
  it('lists each preset, plus custom and none', () => {
    // The control for every schema case below: a preset the model gained and
    // this list never learned would be unselectable and unsaveable.
    for (const protocol of FAST_PROTOCOLS) {
      assert.ok(routineChoices.includes(protocol.id), `${protocol.id} is a preset the routine cannot be set to`);
    }
    assert.ok(routineChoices.includes('custom'));
    assert.ok(routineChoices.includes('none'));
  });
});

describe('the routine schema', () => {
  it('accepts a window with a usual start time', () => {
    const result = schema.safeParse(submission({ routineProtocolId: '16:8', routineStartMinute: '20:00' }));
    assert.equal(result.success, true, messagesOf(result).join(' / '));
    assert.equal(result.data?.routineProtocolId, '16:8');
    assert.equal(result.data?.routineStartMinute, 20 * 60);
    assert.equal(result.data?.routineCustomHours, null);
  });

  it('takes an empty time as "no usual hour" rather than midnight', () => {
    const result = schema.safeParse(submission({ routineProtocolId: '16:8' }));
    assert.equal(result.success, true, messagesOf(result).join(' / '));
    assert.equal(result.data?.routineStartMinute, null);
  });

  it('refuses minute 1440, the hour that does not exist', () => {
    const result = schema.safeParse(submission({ routineProtocolId: '16:8', routineStartMinute: '24:00' }));
    assert.equal(result.success, false);
    assert.deepEqual(messagesOf(result), [enCommon.settings.fasting.startTime.invalid]);

    // CONTROL: the last minute of the day is accepted, so the refusal above is
    // about 1440 and not about the time field being unusable.
    const lastMinute = schema.safeParse(submission({ routineProtocolId: '16:8', routineStartMinute: '23:59' }));
    assert.equal(lastMinute.success, true, messagesOf(lastMinute).join(' / '));
    assert.equal(lastMinute.data?.routineStartMinute, 1439);
  });

  it('refuses 73 custom hours, one past the outer edge the model names', () => {
    const result = schema.safeParse(submission({ routineProtocolId: 'custom', routineCustomHours: '73' }));
    assert.equal(result.success, false);
    assert.deepEqual(messagesOf(result), [
      enCommon.fasting.errors.customHours.replace('{{min}}', '1').replace('{{max}}', '72'),
    ]);

    // CONTROL: 72 is accepted, so the refusal is about the bound rather than
    // about custom hours never parsing at all.
    const atTheEdge = schema.safeParse(submission({ routineProtocolId: 'custom', routineCustomHours: '72' }));
    assert.equal(atTheEdge.success, true, messagesOf(atTheEdge).join(' / '));
    assert.equal(atTheEdge.data?.routineCustomHours, 72);
  });

  it('refuses a custom routine with no hours typed', () => {
    const result = schema.safeParse(submission({ routineProtocolId: 'custom' }));
    assert.equal(result.success, false);
  });
});

describe('the patch a submission becomes', () => {
  it('clears all three routine fields for "None"', () => {
    const result = schema.safeParse(submission({ routineProtocolId: 'none', routineStartMinute: '20:00' }));
    assert.equal(result.success, true, messagesOf(result).join(' / '));
    assert.deepEqual(result.data === undefined ? null : fastingRoutinePatch(result.data), {
      routineProtocolId: null,
      routineCustomHours: null,
      routineStartMinute: null,
    });
  });

  it('the control: a chosen window keeps the hour that was typed beside it', () => {
    const result = schema.safeParse(submission({ routineProtocolId: '18:6', routineStartMinute: '20:00' }));
    assert.equal(result.success, true, messagesOf(result).join(' / '));
    assert.deepEqual(result.data === undefined ? null : fastingRoutinePatch(result.data), {
      routineProtocolId: '18:6',
      routineCustomHours: null,
      routineStartMinute: 1200,
    });
  });

  it('keeps the hour count only for the window that owns it', () => {
    const result = schema.safeParse(submission({ routineProtocolId: 'custom', routineCustomHours: '20' }));
    assert.equal(result.success, true, messagesOf(result).join(' / '));
    assert.equal(result.data === undefined ? null : fastingRoutinePatch(result.data).routineCustomHours, 20);
  });
});

/** The care card under a router, which is what `useFetcher` needs. */
function renderCareCard(settings: LocalFastingSettings): string {
  const router = createMemoryRouter([{ path: '/', element: withI18n(createElement(FastingCareCard, { settings })) }], {
    initialEntries: ['/'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe('the care acknowledgement line', () => {
  it('says the note is still to come while nothing is acknowledged', () => {
    const markup = renderCareCard(NOTHING_SET);
    assert.ok(markup.includes(enCommon.settings.fasting.care.pending), markup.slice(0, 600));
    assert.equal(markup.includes(enCommon.settings.fasting.care.acknowledged), false);
    // The button that puts the note back belongs to the other state only.
    assert.equal(markup.includes(enCommon.settings.fasting.care.reset), false);
  });

  it('says it has been read once an instant is stored, and offers it again', () => {
    const markup = renderCareCard(settingsWith({ extendedAcknowledgedAt: 1_760_000_000_000 }));
    assert.ok(markup.includes(enCommon.settings.fasting.care.acknowledged), markup.slice(0, 600));
    assert.equal(markup.includes(enCommon.settings.fasting.care.pending), false);
    assert.ok(markup.includes(enCommon.settings.fasting.care.reset));
  });
});

describe('the hub row status line', () => {
  it('names the window and the hour when both are set', () => {
    const status = fastingRowStatus({
      settings: settingsWith({ routineProtocolId: '16:8', routineStartMinute: 20 * 60 }),
      t,
    });
    assert.equal(status, t('settings.hub.fasting.description', { routine: '16:8', time: '20:00' }));
    // The catalog really does put both facts in the sentence, so the assertion
    // above is not comparing two copies of an unresolved key.
    assert.ok(status?.includes('16:8'));
    assert.ok(status?.includes('20:00'));
  });

  it('names the window alone when no hour was given', () => {
    assert.equal(fastingRowStatus({ settings: settingsWith({ routineProtocolId: '16:8' }), t }), '16:8');
  });

  it('says there is no usual fast when nothing is stored', () => {
    assert.equal(fastingRowStatus({ settings: NOTHING_SET, t }), enCommon.settings.hub.fasting.none);
    assert.equal(fastingRowStatus({ settings: null, t }), enCommon.settings.hub.fasting.none);
  });

  it('says nothing at all while the device read is still in flight', () => {
    assert.equal(fastingRowStatus({ settings: undefined, t }), null);
  });

  it('prints an extended fast by its catalog label and a custom one by its hours', () => {
    assert.equal(fastingRoutineLabel({ settings: settingsWith({ routineProtocolId: '24h' }), t }), '24 h');
    assert.equal(
      fastingRoutineLabel({ settings: settingsWith({ routineProtocolId: 'custom', routineCustomHours: 20 }), t }),
      t('settings.fasting.routine.customHours', { hours: 20 }),
    );
  });
});

describe('a stored minute as a wall clock', () => {
  it('zero-pads both halves, which is the one format a time input accepts', () => {
    assert.equal(formatRoutineMinute(0), '00:00');
    assert.equal(formatRoutineMinute(9 * 60 + 5), '09:05');
    assert.equal(formatRoutineMinute(1439), '23:59');
  });
});
