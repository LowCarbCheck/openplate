/**
 * The shared reproductive-status fieldset (M206/02), rendered for real.
 *
 * There is no DOM test library in this repo, so this file renders the component
 * through `renderToStaticMarkup` against the SHIPPED English catalog, exactly
 * as `describe-route.test.ts` does. That is enough to prove the three things
 * that decide whether this screen works:
 *
 *  1. WHO is asked. The chips render for someone who answered "prefer not to
 *     say" or nothing at all, and not for someone who answered "male". The old
 *     `=== 'female'` gate made a pregnant person choose between telling the app
 *     their sex and recording a pregnancy at all.
 *  2. WHICH date the chosen chip reveals, with the other chip as the control.
 *  3. That the derived line is really derived: a due date 20 weeks out reports
 *     the second trimester, and a blank one reports the not-set line instead.
 *
 * EVERY ASSERTION HAS A CONTROL. The copy is read out of the catalog rather
 * than typed in here, so a rewording in `en/common.json` does not redden this
 * file, but a key the component stopped resolving does: `bodyMetrics.` never
 * appears in the markup of a working render.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { z } from 'zod';

import { withI18n } from './trends-i18n-harness';
import {
  ReproductiveStatusFields,
  type ReproductiveStatusValue,
} from '../../app/components/reproductive-status-fields';

const TODAY = '2026-09-09';

/** 140 days out is 20 weeks until the due date, which is gestation week 20: the second trimester. */
const DUE_DATE_20_WEEKS_ALONG = '2027-01-27';

/**
 * The shipped copy this file compares against, parsed rather than indexed, so a
 * key renamed in the catalog but not in the component fails HERE instead of
 * shipping a raw `bodyMetrics.reproductive.dueDate.label` to a person.
 */
const copySchema = z.object({
  bodyMetrics: z.object({
    reproductive: z.object({
      legend: z.string(),
      derivedTrimester: z.string(),
      derivedMonths_other: z.string(),
      derivedNotSet: z.string(),
      dueDate: z.object({ label: z.string() }),
      startDate: z.object({ label: z.string() }),
      trimester: z.object({ second: z.string() }),
      weeksAlong: z.object({ label: z.string() }),
    }),
  }),
});

const copy = copySchema.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
).bodyMetrics.reproductive;

/**
 * The catalog line with its placeholders filled in, so the assertion is the
 * WHOLE sentence the person reads rather than a bare number that could match
 * anything else in the markup.
 */
function interpolate(template: string, values: Readonly<Record<string, string>>): string {
  let filled = template;
  for (const [key, value] of Object.entries(values)) {
    filled = filled.split(`{{${key}}}`).join(value);
  }
  assert.equal(filled.includes('{{'), false, `unfilled placeholder in "${template}"`);
  return filled;
}

const BLANK: ReproductiveStatusValue = { reproductiveStatus: 'none', pregnancyDueDate: '', lactationStartDate: '' };
const PREGNANT: ReproductiveStatusValue = { ...BLANK, reproductiveStatus: 'pregnant' };
const LACTATING: ReproductiveStatusValue = { ...BLANK, reproductiveStatus: 'lactating' };

/** The whole `<...>` tag that carries `needle`, from its opening angle bracket to its close. */
function tagContaining(markup: string, needle: string): string {
  const hit = markup.indexOf(needle);
  assert.notEqual(hit, -1, `no tag carries ${needle}`);
  const start = markup.lastIndexOf('<', hit);
  return markup.slice(start, markup.indexOf('>', hit) + 1);
}

function render(input: { biologicalSex: string | null; value: ReproductiveStatusValue }): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(ReproductiveStatusFields, {
        biologicalSex: input.biologicalSex,
        value: input.value,
        onChange: () => {},
        today: TODAY,
        statusName: 'reproductiveStatus',
        dueDateField: { name: 'pregnancyDueDate', id: 'pregnancyDueDate' },
        lactationStartDateField: { name: 'lactationStartDate', id: 'lactationStartDate' },
        chipClassName: (isSelected) => (isSelected ? 'chip-selected' : 'chip'),
      }),
    ),
  );
}

describe('ReproductiveStatusFields, who is asked', () => {
  it('asks someone who gave no answer at all, and someone who declined', () => {
    for (const biologicalSex of [null, '']) {
      const markup = render({ biologicalSex, value: BLANK });
      assert.equal(markup.includes('name="reproductiveStatus"'), true);
      assert.equal(markup.includes(copy.legend), true);
    }
  });

  it('asks someone who answered female', () => {
    const markup = render({ biologicalSex: 'female', value: BLANK });
    assert.equal(markup.includes('name="reproductiveStatus"'), true);
  });

  it('does not ask someone who answered male', () => {
    const markup = render({ biologicalSex: 'male', value: BLANK });
    assert.equal(markup, '');
  });

  it('resolves its copy rather than rendering raw keys', () => {
    const markup = render({ biologicalSex: null, value: BLANK });
    assert.equal(markup.includes('bodyMetrics.'), false);
  });
});

describe('ReproductiveStatusFields, the date the chip reveals', () => {
  it('shows the due date and the weeks-along helper only while pregnant', () => {
    const pregnant = render({
      biologicalSex: null,
      value: { ...BLANK, reproductiveStatus: 'pregnant' },
    });
    assert.equal(pregnant.includes('name="pregnancyDueDate"'), true);
    assert.equal(pregnant.includes(copy.weeksAlong.label), true);
    // The control: the same fieldset with no status shows neither.
    const none = render({ biologicalSex: null, value: BLANK });
    assert.equal(none.includes('name="pregnancyDueDate"'), false);
    assert.equal(none.includes(copy.weeksAlong.label), false);
  });

  it('shows the birth date only while breastfeeding, and never both dates at once', () => {
    const lactating = render({
      biologicalSex: null,
      value: { ...BLANK, reproductiveStatus: 'lactating' },
    });
    assert.equal(lactating.includes('name="lactationStartDate"'), true);
    assert.equal(lactating.includes('name="pregnancyDueDate"'), false);

    const pregnant = render({ biologicalSex: null, value: { ...BLANK, reproductiveStatus: 'pregnant' } });
    assert.equal(pregnant.includes('name="lactationStartDate"'), false);
  });

  it('renders each date as a real date input rather than a free-text box', () => {
    // The whole tag, found by walking BACK to its `<`: React writes `type`
    // before `name`, so a forward slice from the name would miss it and the
    // assertion would be unfalsifiable.
    assert.equal(tagContaining(render({ biologicalSex: null, value: PREGNANT }), 'name="pregnancyDueDate"').includes('type="date"'), true);
    assert.equal(tagContaining(render({ biologicalSex: null, value: LACTATING }), 'name="lactationStartDate"').includes('type="date"'), true);
    // The control: the weeks-along helper is a number box, and it submits nothing.
    const weeksTag = tagContaining(render({ biologicalSex: null, value: PREGNANT }), 'id="pregnancyDueDate-weeks"');
    assert.equal(weeksTag.includes('type="number"'), true);
    assert.equal(weeksTag.includes('name='), false);
  });
});

describe('ReproductiveStatusFields, the derived line', () => {
  it('reports the trimester a due date 20 weeks along implies', () => {
    const markup = render({
      biologicalSex: null,
      value: { ...BLANK, reproductiveStatus: 'pregnant', pregnancyDueDate: DUE_DATE_20_WEEKS_ALONG },
    });
    const expected = interpolate(copy.derivedTrimester, {
      trimester: copy.trimester.second,
      week: '20',
    });
    assert.equal(markup.includes(expected), true);
    assert.equal(markup.includes(copy.derivedNotSet), false);
  });

  it('says the date is not set when it is blank, rather than reporting week 1', () => {
    const markup = render({ biologicalSex: null, value: { ...BLANK, reproductiveStatus: 'pregnant' } });
    assert.equal(markup.includes(copy.derivedNotSet), true);
    assert.equal(markup.includes(copy.trimester.second), false);
  });

  it('counts the months of breastfeeding from the birth date', () => {
    const markup = render({
      biologicalSex: null,
      value: { ...BLANK, reproductiveStatus: 'lactating', lactationStartDate: '2026-05-09' },
    });
    const expected = interpolate(copy.derivedMonths_other, { count: '4' });
    assert.equal(markup.includes(expected), true);
    assert.equal(markup.includes(copy.derivedNotSet), false);

    // The control: no birth date, no month count.
    const blank = render({ biologicalSex: null, value: { ...BLANK, reproductiveStatus: 'lactating' } });
    assert.equal(blank.includes(copy.derivedNotSet), true);
  });
});

/**
 * WHERE the fieldset is rendered, read off the two route sources (M215 spec
 * 01). Neither route can be rendered here (both are client-loader routes over
 * IndexedDB), so this reads the source the way `no-telemetry-wiring.test.ts`
 * does: the import and the JSX tag together, so a route that imported the
 * component and never used it would still fail.
 *
 * The pair IS the control: the same two checks answer the opposite way for the
 * page that gave the fieldset up.
 */
function routeSource(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../../app/routes/${file}`, import.meta.url)), 'utf8');
}

/** Does this route import the shared fieldset AND render it? */
function rendersTheFieldset(source: string): boolean {
  return (
    source.includes("from '#app/components/reproductive-status-fields'") &&
    source.includes('<ReproductiveStatusFields')
  );
}

describe('ReproductiveStatusFields, which screens render it', () => {
  it('is rendered by the life-phase settings page', () => {
    assert.equal(rendersTheFieldset(routeSource('settings.life-phase.tsx')), true);
  });

  it('is no longer rendered by the body metrics card on the goals page', () => {
    // The control for the case above: the same two checks, the page the
    // fieldset moved OFF, and the answer flips.
    assert.equal(rendersTheFieldset(routeSource('settings.goals.tsx')), false);
  });

  it('is still rendered by the onboarding body step, which this move did not touch', () => {
    assert.equal(rendersTheFieldset(routeSource('onboarding.tsx')), true);
  });
});
