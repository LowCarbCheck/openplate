/**
 * The care sheet on `/fasting`: what it says, when it is due, and that an
 * acknowledgement closes it for good.
 *
 * WHY PART OF THIS IS SOURCE LEVEL. `CareSheet` renders through
 * `Sheet`/`SheetContent`, which is a Radix dialog inside a portal. A portal
 * renders to nothing under `renderToStaticMarkup` (the portal mounts in a
 * layout effect, and effects never run there), so the three paragraphs and the
 * button cannot be read out of markup. The first test below PROVES that, with
 * `PregnancyNotice` through the same harness as its control, so the
 * source-level route the rest of the file takes is a measured fact rather than
 * an excuse. `add-launcher-targets.test.ts` took the same route for the same
 * reason.
 *
 * The copy claims are still real claims: the sheet body is asserted to render
 * exactly the `fasting.care.who`, `.stop` and `.water` keys, and each of those
 * keys is asserted to resolve in the shipped English catalog. A key renamed in
 * one place and not the other fails here.
 *
 * WHAT IS NOT TESTABLE WITHOUT A SOURCE CHANGE. The route-level gate is
 * `isCareSheetDue`, a closure inside `PlanFastCard`, and `PlanFastCard` is not
 * exported from `app/routes/fasting.tsx`. Neither the closure nor the card can
 * be called from a test. The "closed once acknowledged" claim is therefore
 * made of two pinned links: `isCareSheetDue` delegating to `needsCareSheet`
 * with the stored `extendedAcknowledgedAt`, and `needsCareSheet` returning
 * false once that field is set.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { z } from 'zod';

import { CareSheet, PregnancyNotice } from '../../app/components/fasting/care-notice';
import { needsCareSheet } from '../../app/models/fasting-care';
import { withI18n } from './trends-i18n-harness';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const ACKNOWLEDGED_AT = 1_750_000_000_000;

/**
 * The copy this file makes claims about, parsed out of the shipped catalog at
 * read time. `looseObject` keeps every other key, so a rename of any key below
 * fails loudly at import instead of resolving to the key string at render.
 */
const EnglishCatalog = z.looseObject({
  fasting: z.looseObject({
    care: z.looseObject({
      title: z.string(),
      who: z.string(),
      stop: z.string(),
      water: z.string(),
      understood: z.string(),
      pregnancyNotice: z.string(),
    }),
  }),
});

const careCopy = EnglishCatalog.parse(
  JSON.parse(readFileSync(fileURLToPath(new URL('../../app/i18n/locales/en/common.json', import.meta.url)), 'utf8')),
).fasting.care;

const CARE_NOTICE_SOURCE = readFileSync(
  new URL('../../app/components/fasting/care-notice.tsx', import.meta.url),
  'utf8',
);

const FASTING_ROUTE_SOURCE = readFileSync(new URL('../../app/routes/fasting.tsx', import.meta.url), 'utf8');

/** The body of one exported function in `care-notice.tsx`, from its signature to the file's next one. */
function functionBody(name: string): string {
  const start = CARE_NOTICE_SOURCE.indexOf(`export function ${name}(`);
  assert.notEqual(start, -1, `care-notice.tsx no longer exports ${name}`);
  const rest = CARE_NOTICE_SOURCE.slice(start + 1);
  const next = rest.indexOf('\nexport function ');
  return next === -1 ? rest : rest.slice(0, next);
}

const CARE_SHEET_BODY = functionBody('CareSheet');

/** A handler that records nothing: none of the sheet's callbacks fire in a static render. */
const noop = (): void => {};

describe('the care sheet under renderToStaticMarkup', () => {
  it('renders to nothing, open or closed, because its content sits in a Radix portal', () => {
    const open = renderToStaticMarkup(
      withI18n(createElement(CareSheet, { isOpen: true, onOpenChange: noop, onUnderstood: noop })),
    );
    const closed = renderToStaticMarkup(
      withI18n(createElement(CareSheet, { isOpen: false, onOpenChange: noop, onUnderstood: noop })),
    );

    assert.equal(open, '', 'the sheet renders markup now, so the source-level assertions below can be dropped');
    assert.equal(closed, '');
    // The control that makes the two lines above a measurement rather than a
    // broken harness: a non-portal component through the SAME wrapper renders
    // its real English copy.
    assert.match(renderToStaticMarkup(withI18n(createElement(PregnancyNotice))), /Fasting is not advised/);
  });
});

describe('what the care sheet says', () => {
  it('renders the three care paragraphs, and each key resolves in the shipped catalog', () => {
    for (const key of ['who', 'stop', 'water']) {
      assert.match(
        CARE_SHEET_BODY,
        new RegExp(`<p className="text-sm text-muted-foreground">\\{t\\('fasting\\.care\\.${key}'\\)\\}</p>`),
        `the sheet no longer renders a paragraph for fasting.care.${key}`,
      );
    }

    assert.match(careCopy.who, /pregnant or breastfeeding/);
    assert.match(careCopy.stop, /Stop and eat/);
    assert.match(careCopy.water, /Drink water/);
    // The control on the loop above: a key the sheet does NOT render must not
    // match it. Without this, a loop body that matched anything would pass.
    assert.doesNotMatch(CARE_SHEET_BODY, /fasting\.care\.pregnancyNotice/);
  });

  it('renders exactly three paragraphs, so a fourth care claim cannot arrive unnoticed', () => {
    assert.equal((CARE_SHEET_BODY.match(/<p className="text-sm text-muted-foreground">/g) ?? []).length, 3);
  });

  it('renders the Understood button, the one action the sheet offers', () => {
    assert.match(CARE_SHEET_BODY, /<Button[\s\S]{0,240}?\{t\('fasting\.care\.understood'\)\}/);
    assert.equal(careCopy.understood, 'Understood');
    // The button ACKNOWLEDGES; a dismiss must not. A second button in this
    // body would mean a second way out that the route has not been told about.
    assert.equal((CARE_SHEET_BODY.match(/<Button/g) ?? []).length, 1);
  });

  it('carries the sheet title, so the sheet is not an unlabelled slab', () => {
    assert.match(CARE_SHEET_BODY, /<SheetTitle>\{t\('fasting\.care\.title'\)\}<\/SheetTitle>/);
    assert.equal(careCopy.title, 'Before a long fast');
  });
});

describe('needsCareSheet, the decision the sheet is gated on', () => {
  it('is true at exactly 24 h while never acknowledged', () => {
    assert.equal(needsCareSheet({ targetMs: 24 * HOUR, extendedAcknowledgedAt: null }), true);
  });

  it('is false one minute below 24 h, which is the off-by-one that matters', () => {
    assert.equal(needsCareSheet({ targetMs: 24 * HOUR - MINUTE, extendedAcknowledgedAt: null }), false);
    // 23 h 59 m is the control on the line above in the other direction: the
    // boundary has to be 24 h exactly, not "roughly a day".
    assert.equal(needsCareSheet({ targetMs: 23 * HOUR + 59 * MINUTE, extendedAcknowledgedAt: null }), false);
  });

  it('is false at 24 h once acknowledged, and stays false for longer targets', () => {
    assert.equal(needsCareSheet({ targetMs: 24 * HOUR, extendedAcknowledgedAt: ACKNOWLEDGED_AT }), false);
    assert.equal(needsCareSheet({ targetMs: 72 * HOUR, extendedAcknowledgedAt: ACKNOWLEDGED_AT }), false);
    // The control both ways: the same targets with no acknowledgement DO fire,
    // so the false above is the acknowledgement and not a dead threshold.
    assert.equal(needsCareSheet({ targetMs: 24 * HOUR, extendedAcknowledgedAt: null }), true);
    assert.equal(needsCareSheet({ targetMs: 72 * HOUR, extendedAcknowledgedAt: null }), true);
  });

  it('treats an acknowledgement at epoch 0 as an acknowledgement, not as absent', () => {
    // A `!extendedAcknowledgedAt` test would read 0 as never acknowledged and
    // re-ask a person whose record says otherwise. The model uses `!== null`.
    assert.equal(needsCareSheet({ targetMs: 48 * HOUR, extendedAcknowledgedAt: 0 }), false);
  });
});

describe('how /fasting wires the sheet', () => {
  it('opens the sheet from a state flag, so an acknowledged profile never opens it', () => {
    assert.match(FASTING_ROUTE_SOURCE, /<CareSheet\s+isOpen=\{isCareOpen\}/);
    assert.match(FASTING_ROUTE_SOURCE, /const \[isCareOpen, setIsCareOpen\] = useState\(false\)/);
  });

  it('asks needsCareSheet with the STORED acknowledgement, not with a fresh null', () => {
    const gate = FASTING_ROUTE_SOURCE.slice(FASTING_ROUTE_SOURCE.indexOf('const isCareSheetDue ='));
    assert.notEqual(gate, '', 'isCareSheetDue is gone from the route');
    assert.match(gate.slice(0, 500), /needsCareSheet\(\{[\s\S]{0,240}?extendedAcknowledgedAt: fastingSettings\.extendedAcknowledgedAt/);
    // The control: a gate that passed a literal null would re-ask every time.
    assert.doesNotMatch(gate.slice(0, 500), /extendedAcknowledgedAt: null/);
  });

  it('writes the acknowledgement to the settings record, which is what makes it stick', () => {
    assert.match(FASTING_ROUTE_SOURCE, /putLocalFastingSettings\(\{ extendedAcknowledgedAt: Date\.now\(\) \}\)/);
  });

  it('does not acknowledge on a dismiss, so backing out leaves the sheet due', () => {
    assert.match(FASTING_ROUTE_SOURCE, /onOpenChange=\{\(open\) => \{[\s\S]{0,200}?if \(!open\) pendingStartRef\.current = null;/);
  });
});
