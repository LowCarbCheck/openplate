/**
 * The quiet notice above the plan card on `/fasting`, and the two caps that
 * travel with it.
 *
 * THE CLAIM THIS FILE EXISTS FOR is a design claim, not a layout one: the
 * notice is a muted card in ordinary text, never amber and never destructive.
 * Colouring it as an alarm would make it a thing to dismiss rather than a
 * thing to read, and the person it addresses already knows they are pregnant
 * (DESIGN.md section 10.1, and the module comment on `care-notice.tsx`). A
 * class list is exactly the kind of thing a later "make it stand out" edit
 * changes without anybody noticing, so it is pinned here with a positive
 * control on the muted class it does use.
 *
 * `PregnancyNotice` takes no props and is unconditional: the gate is in the
 * route, `{isCareStatus(reproductiveStatus) && <PregnancyNotice />}`. The
 * route component is not callable from a test (it wants loader data, a router
 * and a live clock), so `renderNoticeFor` below MIRRORS that one line, and a
 * source assertion pins the mirror to the route. If the route's gate changes
 * shape, the mirror test fails rather than going quietly stale.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PregnancyNotice } from '../../app/components/fasting/care-notice';
import {
  FAST_CARE_MAX_HOURS,
  isCareStatus,
  maxCustomHoursForStatus,
  presetsForStatus,
} from '../../app/models/fasting-care';
import { FAST_MAX_CUSTOM_HOURS, FAST_PROTOCOLS } from '../../app/models/fasting';
import type { ReproductiveStatus } from '../../app/lib/local-store/schema';
import { withI18n } from './trends-i18n-harness';

const CARE_NOTICE_SOURCE = readFileSync(
  new URL('../../app/components/fasting/care-notice.tsx', import.meta.url),
  'utf8',
);

const FASTING_ROUTE_SOURCE = readFileSync(new URL('../../app/routes/fasting.tsx', import.meta.url), 'utf8');

/** The route's own gate, reproduced: the notice renders only for a care status. */
function renderNoticeFor(status: ReproductiveStatus | null): string {
  if (!isCareStatus(status)) return '';
  return renderToStaticMarkup(withI18n(createElement(PregnancyNotice)));
}

/** The `PregnancyNotice` body, from its signature to the end of the file. */
function noticeBody(): string {
  const start = CARE_NOTICE_SOURCE.indexOf('export function PregnancyNotice(');
  assert.notEqual(start, -1, 'care-notice.tsx no longer exports PregnancyNotice');
  return CARE_NOTICE_SOURCE.slice(start);
}

describe('who sees the pregnancy notice', () => {
  it('renders the notice copy for pregnant', () => {
    assert.match(renderNoticeFor('pregnant'), /Fasting is not advised while pregnant or breastfeeding/);
  });

  it('renders the notice copy for lactating, which is the status a "pregnant" check would miss', () => {
    assert.match(renderNoticeFor('lactating'), /Fasting is not advised while pregnant or breastfeeding/);
  });

  it('renders nothing for none, and nothing for a device that has never answered', () => {
    assert.equal(renderNoticeFor('none'), '');
    assert.equal(renderNoticeFor(null), '');
    // The control on both: the component itself DOES render when it is
    // reached, so the empty strings above are the gate and not a dead render.
    assert.notEqual(renderToStaticMarkup(withI18n(createElement(PregnancyNotice))), '');
  });

  it('renders the notice with the promise that nothing else changes, not a scolding', () => {
    assert.match(renderNoticeFor('pregnant'), /Your diary and goals stay as they are/);
  });

  it('is gated in the route by exactly the isCareStatus line this file mirrors', () => {
    assert.match(FASTING_ROUTE_SOURCE, /\{isCareStatus\(reproductiveStatus\) && <PregnancyNotice \/>\}/);
  });
});

describe('the notice is muted, never an alarm', () => {
  it('carries no amber and no destructive class', () => {
    const markup = renderNoticeFor('pregnant');

    assert.doesNotMatch(markup, /amber/, 'the notice is coloured as a warning now');
    assert.doesNotMatch(markup, /destructive/, 'the notice is coloured as an error now');
    // The rendered markup carries only the classes React emitted; the SOURCE
    // is checked too, so a conditional class that this one render misses still
    // fails.
    assert.doesNotMatch(noticeBody(), /amber|destructive/);
  });

  it('does use the muted card classes, which is what makes the two lines above falsifiable', () => {
    const markup = renderNoticeFor('pregnant');

    assert.match(markup, /class="[^"]*bg-muted\/40[^"]*"/, 'the notice is no longer a muted card');
    assert.match(markup, /class="[^"]*text-muted-foreground[^"]*"/, 'the notice text is no longer muted');
  });

  it('has no icon and no button, so there is nothing to dismiss', () => {
    const markup = renderNoticeFor('pregnant');

    assert.doesNotMatch(markup, /<svg/, 'the notice grew a warning icon');
    assert.doesNotMatch(markup, /<button/, 'the notice grew something to dismiss');
    assert.match(markup, /<p /, 'the notice is not a paragraph any more');
  });
});

describe('the presets a care status is offered', () => {
  it('offers pregnant only windows at or under 16 hours', () => {
    const presets = presetsForStatus('pregnant');

    assert.ok(presets.length > 0, 'a care status is offered nothing at all');
    for (const protocol of presets) {
      assert.ok(
        protocol.fastingHours <= FAST_CARE_MAX_HOURS,
        `${protocol.id} is ${protocol.fastingHours} h, past the ${FAST_CARE_MAX_HOURS} h cap`,
      );
    }
    // The control on the loop: the unfiltered list DOES contain longer
    // windows, so an empty or already-short list is not what passed above.
    assert.ok(FAST_PROTOCOLS.some((protocol) => protocol.fastingHours > FAST_CARE_MAX_HOURS));
    assert.ok(presets.length < FAST_PROTOCOLS.length, 'the filter removed nothing');
  });

  it('offers lactating the same shortened list', () => {
    assert.deepEqual(presetsForStatus('lactating'), presetsForStatus('pregnant'));
  });

  it('offers none all seven, and so does a profile that never answered', () => {
    assert.equal(presetsForStatus('none').length, 7);
    assert.deepEqual(presetsForStatus('none'), FAST_PROTOCOLS);
    assert.deepEqual(presetsForStatus(null), FAST_PROTOCOLS);
    // The control: seven is the whole catalogue, not a number that happens to
    // match. A preset added or removed upstream fails here.
    assert.equal(FAST_PROTOCOLS.length, 7);
  });
});

describe('the custom-hours ceiling', () => {
  it('caps pregnant at 16, so a hidden preset cannot be reached by typing it', () => {
    assert.equal(maxCustomHoursForStatus('pregnant'), 16);
    assert.equal(maxCustomHoursForStatus('lactating'), 16);
  });

  it('leaves none at 72, the ceiling the model itself sets', () => {
    assert.equal(maxCustomHoursForStatus('none'), 72);
    assert.equal(maxCustomHoursForStatus(null), 72);
    // The control that 16 and 72 are two different rules and not one constant
    // read twice.
    assert.equal(FAST_MAX_CUSTOM_HOURS, 72);
    assert.notEqual(FAST_CARE_MAX_HOURS, FAST_MAX_CUSTOM_HOURS);
  });
});
