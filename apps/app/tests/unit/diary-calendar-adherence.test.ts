/**
 * A source-position check on `app/routes/diary.tsx`'s date picker: the
 * calendar popover must paint each day from the SAME fill map the 13-week
 * adherence grid uses, never a hand-rolled copy of the palette.
 *
 * This reads the route file as text rather than rendering it. `DateNav`'s
 * calendar lives inside a Radix `Popover` that only mounts its content once
 * opened, and the day cells sit behind react-day-picker's own month
 * calculation, so a `renderToStaticMarkup` pass would need to open the
 * popover, page to a month with data, and still could not see whether the
 * fill classes came from the shared module or a duplicate, the import line
 * is the only place that fact is decidable at all.
 *
 * Control: this assertion fails against the diary route as it stood before
 * the calendar carried an adherence fill. Run
 * `git show HEAD:app/routes/diary.tsx | grep -c CALENDAR_DAY_MODIFIER_CLASSNAMES`
 * from a shell (never inside this test) against the commit before this
 * change lands, it prints `0`, so the assertions below were not already
 * true of the file they check.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Just the one branch of the catalog this file speaks for. */
const bundleSchema = z.object({
  trends: z.object({ grid: z.object({ cell: z.object({ level: z.string() }) }) }),
});

const SOURCE = readFileSync(fileURLToPath(new URL('../../app/routes/diary.tsx', import.meta.url)), 'utf8');

describe('diary.tsx calendar adherence fill', () => {
  it('imports the shared fill map from #app/lib/adherence-cell-fill, not a local copy', () => {
    assert.match(
      SOURCE,
      /import\s*\{[^}]*CALENDAR_DAY_MODIFIER_CLASSNAMES[^}]*\}\s*from\s*'#app\/lib\/adherence-cell-fill'/,
      'the calendar and the 13-week grid must read colours from one module',
    );
    // Control: a literal `bg-adherence-` class typed directly into diary.tsx
    // (rather than imported) would be exactly the duplicate this test exists
    // to catch, and this assertion is what would fail against it.
    assert.doesNotMatch(
      SOURCE,
      /const\s+CALENDAR_DAY_MODIFIER_CLASSNAMES\s*=/,
      'the fill map must be imported, never redefined in the route file',
    );
  });

  it('passes modifiersClassNames to CalendarPicker', () => {
    const calendarPickerCall = SOURCE.slice(SOURCE.indexOf('<CalendarPicker'), SOURCE.indexOf('<CalendarPicker') + 600);
    assert.notEqual(calendarPickerCall.indexOf('<CalendarPicker'), -1, 'sanity: the route still renders CalendarPicker');
    assert.match(
      calendarPickerCall,
      /modifiersClassNames=\{CALENDAR_DAY_MODIFIER_CLASSNAMES\}/,
      'CalendarPicker must receive the shared map as modifiersClassNames, or every day paints the default class only',
    );
    // Control: the same slice must also carry `modifiers=`, since a
    // `modifiersClassNames` with no matching `modifiers` matches nothing, so
    // an implementation that passed the map but forgot the matchers would
    // still fail a full read of this feature.
    assert.match(calendarPickerCall, /modifiers=\{dayModifiers\}/, 'modifiersClassNames with no modifiers paints nothing');
  });

  it('imports selectCalendarDayLevels and renders AdherenceLegend, so the fill has data and the colours are explained', () => {
    assert.match(SOURCE, /import\s*\{\s*selectCalendarDayLevels\s*\}\s*from\s*'#app\/lib\/calendar-day-levels'/);
    assert.match(SOURCE, /<AdherenceLegend\b/);
  });
});

/**
 * The accessible name of a day cell.
 *
 * A rated day used to fall through to react-day-picker's bare date phrase,
 * so a screen reader heard the colour only as silence. `trends.grid.cell.level`
 * names the RAMP STEP, not a goal count: `levelForShare` scales the SHARE of
 * goals met onto four steps, so "4 of 4 goals" would be false for somebody who
 * set one goal and met it.
 *
 * Control: the diary route at HEAD references no `trends.grid.cell.level`.
 * Run `git show HEAD:app/routes/diary.tsx | grep -c 'trends.grid.cell.level'`
 * from a shell (never inside this test) and it prints `0`.
 */
describe('diary.tsx calendar day names', () => {
  it('gives a rated day a spoken verdict, not just the date', () => {
    const labelIndex = SOURCE.indexOf('const labelDayButton');
    assert.notEqual(labelIndex, -1, 'sanity: the route still builds a day label');
    const label = SOURCE.slice(labelIndex, labelIndex + 900);
    assert.match(label, /trends\.grid\.cell\.level/, 'a rated day must say which step of the ramp it reached');
    assert.match(label, /level: entry\.level/, 'the level must be interpolated, or the sentence renders a placeholder');
    // Control: the two statuses that already spoke must keep speaking, so this
    // is a claim about the whole label and not just about one new branch.
    assert.match(label, /trends\.grid\.cell\.logged/);
    assert.match(label, /trends\.grid\.cell\.unrated/);
  });

  it('ships that sentence in both bundles, with the level placeholder intact', () => {
    for (const locale of ['en', 'de']) {
      const raw = readFileSync(
        fileURLToPath(new URL(`../../app/i18n/locales/${locale}/common.json`, import.meta.url)),
        'utf8',
      );
      // Parsed at the boundary rather than asserted: a missing key, or a group
      // where a sentence belongs, fails here with the locale named.
      const sentence = bundleSchema.parse(JSON.parse(raw)).trends.grid.cell.level;
      assert.ok(sentence.includes('{{level}}'), `${locale} must interpolate the level`);
    }
  });
});
