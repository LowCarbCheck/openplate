/**
 * The style screen itself (M210 spec 02): the five items, the two follow-up
 * questions, and the caution note.
 *
 * There is no DOM test library in this repo, so the component is rendered to
 * static markup with the REAL English catalog behind it. That is enough for
 * everything asserted here, because the screen's whole state on first paint
 * comes from the loader data handed in: what is ticked, which follow-up is
 * open, and whether the caution shows. A click is the one thing a static
 * render cannot do, so each case that a click would reach is driven by the
 * loader data a returning person arrives with instead.
 *
 * Every assertion below has a control that makes it fail: the "nothing is
 * preselected" case is the same assertion as the "the stored style is ticked"
 * case with the opposite fixture, and each conditional follow-up is asserted
 * present in one fixture and absent in another.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouterProvider, createMemoryRouter } from 'react-router';

import { withI18n } from './trends-i18n-harness';
import { StyleCautionNote, StyleStep } from '../../app/routes/onboarding';
import type { StyleStepData } from '../../app/routes/onboarding';
import { EATING_STYLE_IDS, STYLE_CAUTION_SOURCE_URL } from '../../app/lib/eating-style';
import type { EatingStyleId } from '../../app/lib/eating-style';
import type { ReproductiveStatus } from '../../app/lib/local-store/schema';

/** The loader fields `StyleStep` reads, flattened. Defaults are a first-run device: nothing stored. */
interface StyleStepFixture {
  eatingStyle: EatingStyleId | null;
  goalNetCarbsCeilingG: number | null;
  goalKcalTarget: number | null;
  goalProteinFloorG: number | null;
  reproductiveStatus: ReproductiveStatus | null;
}

function fixture(overrides: Partial<StyleStepFixture> = {}): StyleStepFixture {
  return {
    eatingStyle: null,
    goalNetCarbsCeilingG: null,
    goalKcalTarget: null,
    goalProteinFloorG: null,
    reproductiveStatus: null,
    ...overrides,
  };
}

/**
 * Renders the step inside a memory router, because it contains a `<Form>` and
 * a `useNavigation()` call, both of which need a data router in context.
 */
function renderStyleStep(data: StyleStepFixture): string {
  const loaderData: StyleStepData = {
    eatingStyle: data.eatingStyle,
    goalNetCarbsCeilingG: data.goalNetCarbsCeilingG,
    goalKcalTarget: data.goalKcalTarget,
    goalProteinFloorG: data.goalProteinFloorG,
    bodyMetrics: { reproductiveStatus: data.reproductiveStatus },
  };
  const element = createElement(StyleStep, { loaderData, errors: {} });
  const router = createMemoryRouter([{ path: '/onboarding', element: withI18n(element) }], {
    initialEntries: ['/onboarding?step=focus'],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

/** Every `<input type="radio" name="eatingStyle" ...>` tag in the markup. */
function styleRadios(markup: string): string[] {
  return markup.match(/<input[^>]*name="eatingStyle"[^>]*>/g) ?? [];
}

describe('the style list', () => {
  it('renders the five styles as one single-select group, in the table order', () => {
    const markup = renderStyleStep(fixture());
    const values = styleRadios(markup).map((tag) => /value="([^"]+)"/.exec(tag)?.[1]);
    assert.deepEqual(values, [...EATING_STYLE_IDS]);
  });

  it('names each style in the shipped English copy, so no raw key reaches a screen', () => {
    const markup = renderStyleStep(fixture());
    for (const label of ['Low-carb', 'Low-carb and calories', 'Calories', 'High protein', 'Just track']) {
      assert.ok(markup.includes(label), `missing style label: ${label}`);
    }
  });

  it('carries the "most people start here" hint, and only on low-carb', () => {
    const markup = renderStyleStep(fixture());
    const hints = markup.match(/Most people start here/g) ?? [];
    assert.equal(hints.length, 1);
    // The hint sits inside the low-carb card: after that card's radio, and
    // before the next style's.
    const hintAt = markup.indexOf('Most people start here');
    assert.ok(markup.indexOf('value="low-carb"') < hintAt);
    assert.ok(hintAt < markup.indexOf('value="low-carb-low-kcal"'));
  });

  // THE CONTROL THE SPEC NAMES. A first render ticks nothing, and the case
  // below proves this assertion can fail: the same count, taken from a
  // returning person's fixture, is 1.
  it('ticks nothing on a first run', () => {
    const checked = styleRadios(renderStyleStep(fixture())).filter((tag) => tag.includes('checked'));
    assert.deepEqual(checked, []);
  });

  it('ticks exactly the stored style for a returning person', () => {
    const checked = styleRadios(renderStyleStep(fixture({ eatingStyle: 'high-protein' }))).filter((tag) =>
      tag.includes('checked'),
    );
    assert.equal(checked.length, 1);
    assert.ok(checked[0]?.includes('value="high-protein"'));
  });

  it('ticks the style derived from the numbers when the profile predates the stored pick', () => {
    const checked = styleRadios(renderStyleStep(fixture({ goalNetCarbsCeilingG: 50 }))).filter((tag) =>
      tag.includes('checked'),
    );
    assert.equal(checked.length, 1);
    assert.ok(checked[0]?.includes('value="low-carb"'));
  });
});

/** Whether the 20/50/100 g sub step is on screen. */
function hasCarbSubStep(markup: string): boolean {
  return markup.includes('name="carbPreset"');
}

/** Whether the calorie target field is on screen. */
function hasKcalField(markup: string): boolean {
  return markup.includes('name="kcalTarget"');
}

describe('the two follow-up questions', () => {
  it('asks neither of them before a style is picked', () => {
    const markup = renderStyleStep(fixture());
    assert.equal(hasCarbSubStep(markup), false);
    assert.equal(hasKcalField(markup), false);
  });

  it('asks for a ceiling and nothing else on low-carb', () => {
    const markup = renderStyleStep(fixture({ eatingStyle: 'low-carb' }));
    assert.equal(hasCarbSubStep(markup), true);
    assert.equal(hasKcalField(markup), false);
  });

  it('asks for both on low-carb-low-kcal', () => {
    const markup = renderStyleStep(fixture({ eatingStyle: 'low-carb-low-kcal' }));
    assert.equal(hasCarbSubStep(markup), true);
    assert.equal(hasKcalField(markup), true);
  });

  it('asks for a target and nothing else on low-kcal', () => {
    const markup = renderStyleStep(fixture({ eatingStyle: 'low-kcal' }));
    assert.equal(hasCarbSubStep(markup), false);
    assert.equal(hasKcalField(markup), true);
  });

  it('asks for neither on high-protein or just-track', () => {
    for (const style of ['high-protein', 'just-track'] as const) {
      const markup = renderStyleStep(fixture({ eatingStyle: style }));
      assert.equal(hasCarbSubStep(markup), false, `${style} must not ask for a ceiling`);
      assert.equal(hasKcalField(markup), false, `${style} must not ask for a target`);
    }
  });

  it('offers three ceilings, without "decide later"', () => {
    const markup = renderStyleStep(fixture({ eatingStyle: 'low-carb' }));
    const chips = markup.match(/<input[^>]*name="carbPreset"[^>]*>/g) ?? [];
    assert.equal(chips.length, 3);
    assert.equal(markup.includes('value="later"'), false);
  });

  it('ticks no ceiling for a fresh carb pick, and the stored one for a returning person', () => {
    const fresh = (renderStyleStep(fixture({ eatingStyle: 'low-carb' })).match(
      /<input[^>]*name="carbPreset"[^>]*>/g,
    ) ?? []).filter((tag) => tag.includes('checked'));
    assert.deepEqual(fresh, []);
    const returning = (renderStyleStep(fixture({ eatingStyle: 'low-carb', goalNetCarbsCeilingG: 20 })).match(
      /<input[^>]*name="carbPreset"[^>]*>/g,
    ) ?? []).filter((tag) => tag.includes('checked'));
    assert.equal(returning.length, 1);
    assert.ok(returning[0]?.includes('value="keto"'));
  });
});

/** Renders the note on its own: it is presentational and needs no router. */
function renderCaution(style: EatingStyleId | null, reproductiveStatus: ReproductiveStatus | null): string {
  return renderToStaticMarkup(withI18n(createElement(StyleCautionNote, { style, reproductiveStatus })));
}

describe('the caution note', () => {
  /** The three styles that restrict energy or carbohydrate. */
  const CAUTIONED: readonly EatingStyleId[] = ['low-carb', 'low-carb-low-kcal', 'low-kcal'];

  it('shows for the three restricting styles when the person is pregnant or lactating', () => {
    for (const status of ['pregnant', 'lactating'] as const) {
      for (const style of CAUTIONED) {
        const markup = renderCaution(style, status);
        assert.ok(markup.includes(STYLE_CAUTION_SOURCE_URL), `${style}/${status} must link the source`);
        assert.ok(markup.includes('midwife'), `${style}/${status} must carry the note`);
      }
    }
  });

  // THE CONTROL. Same statuses, the other two styles: nothing at all. Without
  // it, a note that rendered unconditionally would satisfy the case above.
  it('stays away from the two styles it points people at', () => {
    for (const status of ['pregnant', 'lactating'] as const) {
      for (const style of ['high-protein', 'just-track'] as const) {
        assert.equal(renderCaution(style, status), '', `${style}/${status} must render nothing`);
      }
    }
  });

  it('stays away from every style when the status is not one of the two', () => {
    const quietStatuses: readonly (ReproductiveStatus | null)[] = [null, 'none'];
    for (const status of quietStatuses) {
      for (const style of EATING_STYLE_IDS) {
        assert.equal(renderCaution(style, status), '', `${style}/${String(status)} must render nothing`);
      }
    }
  });

  it('renders nothing before a style is picked', () => {
    assert.equal(renderCaution(null, 'pregnant'), '');
  });

  it('is muted text with a link, never a block or a number', () => {
    const markup = renderCaution('low-carb', 'pregnant');
    assert.ok(markup.includes('text-muted-foreground'));
    assert.equal(/\d/.test(markup.replace(/<a[^>]*>/g, '')), false, 'the note must carry no number');
  });
});

describe('the caution note on a first run', () => {
  // Not a wish, a consequence of the step order: the body step, where a
  // status is recorded, comes after this one. A first-run device therefore has
  // no status to caution about, and the settings style card is the surface
  // that carries the note for everyone else (M210 spec 04).
  it('cannot appear, because the style step comes before the body step', () => {
    const markup = renderStyleStep(fixture({ eatingStyle: 'low-carb' }));
    assert.equal(markup.includes(STYLE_CAUTION_SOURCE_URL), false);
  });

  it('appears for someone who re-enters the wizard with a status already on file', () => {
    const markup = renderStyleStep(fixture({ eatingStyle: 'low-carb', reproductiveStatus: 'pregnant' }));
    assert.ok(markup.includes(STYLE_CAUTION_SOURCE_URL));
  });
});
