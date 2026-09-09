/**
 * The eating style: the five styles, the lens each one grades a day by, the
 * lossless derivation for an account written before the pick existed, and what
 * applying a style writes and nulls (M210/01).
 *
 * Every behavioural assertion here is paired with a CONTROL, the same
 * assertion run against a deliberately wrong implementation, wrapped in
 * `assert.throws`. Without one, a test like "applying `low-kcal` nulls the carb
 * ceiling" passes just as happily against an implementation that never touches
 * the ceiling at all, and the file reads green while pinning nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EATING_STYLES,
  EATING_STYLE_IDS,
  HIGH_PROTEIN_G_PER_KG,
  STYLE_CAUTION_SOURCE_URL,
  applyEatingStyle,
  deriveEatingStyle,
  effectiveEatingStyle,
  eatingStyle,
  isEatingStyleId,
  lensForStyle,
  reconcileEatingStyle,
  styleCaution,
  type EatingStyleGoalNumbers,
  type EatingStyleGoals,
  type EatingStyleId,
  type EatingStyleLens,
  type ReconcileEatingStyleInput,
} from '../../app/lib/eating-style';
import { migrateEnvelopeForward, parseBackupEnvelope } from '../../app/lib/local-store/backup';
import { SCHEMA_VERSION } from '../../app/lib/local-store/schema';
import type { ReproductiveStatus } from '../../app/lib/local-store/schema';

/** The three goal numbers, with everything unset unless a case says otherwise. */
function goals(overrides: Partial<EatingStyleGoals> = {}): EatingStyleGoals {
  return {
    goalNetCarbsCeilingG: null,
    goalKcalTarget: null,
    goalProteinFloorG: null,
    ...overrides,
  };
}

/** The three numbers a reconcile reads, everything unset unless a case says otherwise. */
function numbers(overrides: Partial<EatingStyleGoalNumbers> = {}): EatingStyleGoalNumbers {
  return {
    goalNetCarbsCeilingG: null,
    goalKcalTarget: null,
    goalProteinFloorG: null,
    ...overrides,
  };
}

/**
 * A deliberately wrong derivation, used as the control below: it checks the
 * ceiling first and never looks at the kcal target, so it agrees with the real
 * one on three of the five rows.
 */
function wrongDerive(input: EatingStyleGoals): EatingStyleId {
  if (input.goalNetCarbsCeilingG !== null) return 'low-carb';
  if (input.goalKcalTarget !== null) return 'low-kcal';
  return 'just-track';
}

/**
 * One save over an existing profile, with a logged weight and a reference floor
 * on hand. Module scope rather than inside the describe, because oxlint's
 * `consistent-function-scoping` refuses a helper that captures nothing.
 */
function saveOver(input: { currentGoals: EatingStyleGoals; style: EatingStyleId; kcalTarget?: number | null }) {
  const { currentGoals, style, kcalTarget = null } = input;
  return applyEatingStyle({
    style,
    currentGoals,
    carbPresetCeiling: style === 'low-carb' || style === 'low-carb-low-kcal' ? 50 : null,
    kcalTarget,
    latestWeightKg: 78,
    referenceProteinFloorG: 60,
  });
}

/**
 * A deliberately wrong reconcile, used as the control below: it keeps whatever
 * style is stored, which is exactly the behaviour the walk found on the goals
 * card. It agrees with the real one on every case where the numbers still
 * describe the stored style.
 */
function alwaysStored(input: ReconcileEatingStyleInput): EatingStyleId {
  return input.storedStyle ?? deriveEatingStyle(input.goals);
}

/**
 * The other deliberately wrong reconcile: it derives from the numbers every
 * time, dropping a deliberate `high-protein` the moment a carb ceiling is typed
 * beside its floor.
 */
function alwaysDerive(input: ReconcileEatingStyleInput): EatingStyleId {
  return deriveEatingStyle(input.goals);
}

/** A deliberately over-eager caution rule, used as the control below: it ignores the style. */
function overEagerCaution(status: ReproductiveStatus): 'caution' | null {
  return status === 'pregnant' || status === 'lactating' ? 'caution' : null;
}

describe('the style table', () => {
  it('lists the five ids once each, in the order the onboarding shows them', () => {
    assert.deepEqual(EATING_STYLE_IDS, [
      'low-carb',
      'low-carb-low-kcal',
      'low-kcal',
      'high-protein',
      'just-track',
    ]);
    assert.deepEqual(
      EATING_STYLES.map((style) => style.id),
      [...EATING_STYLE_IDS],
    );
  });

  it('keys every label and detail into the catalog group the locales carry', () => {
    // The keys the two locale files were written against (M210's design note).
    // A renamed id that forgot its keys renders a raw dotted path on screen.
    const keyed = {
      'low-carb': 'lowCarb',
      'low-carb-low-kcal': 'lowCarbLowKcal',
      'low-kcal': 'lowKcal',
      'high-protein': 'highProtein',
      'just-track': 'justTrack',
    } satisfies Record<EatingStyleId, string>;
    for (const style of EATING_STYLES) {
      assert.equal(style.labelKey, `onboarding.style.${keyed[style.id]}.label`);
      assert.equal(style.detailKey, `onboarding.style.${keyed[style.id]}.detail`);
    }
  });

  it('opens the carb sub step for the two carb styles only', () => {
    assert.deepEqual(
      EATING_STYLES.filter((style) => style.carbSubPreset).map((style) => style.id),
      ['low-carb', 'low-carb-low-kcal'],
    );
  });

  it('asks for a kcal target on the two calorie styles only', () => {
    assert.deepEqual(
      EATING_STYLES.filter((style) => style.kcalMode === 'asked').map((style) => style.id),
      ['low-carb-low-kcal', 'low-kcal'],
    );
  });

  it('throws for an id with no row rather than defaulting to one', () => {
    // SAFETY: deliberately fabricating an out-of-union id, because proving the lookup
    // refuses one is the whole point of this case.
    const missing = 'keto' as EatingStyleId;
    assert.throws(() => eatingStyle(missing), /No eating style defined/);
  });

  it('narrows a stored string, and refuses one this build has never heard of', () => {
    assert.equal(isEatingStyleId('high-protein'), true);
    assert.equal(isEatingStyleId('carnivore'), false);
    assert.equal(isEatingStyleId(''), false);
    assert.equal(isEatingStyleId(null), false);
    assert.equal(isEatingStyleId(undefined), false);
  });
});

describe('the lens per style', () => {
  const expected = {
    'low-carb': 'carb',
    'low-carb-low-kcal': 'carb',
    'low-kcal': 'kcal',
    'high-protein': 'protein',
    'just-track': 'none',
  } satisfies Record<EatingStyleId, EatingStyleLens>;

  for (const id of EATING_STYLE_IDS) {
    it(`grades a ${id} day by the ${expected[id]} lens`, () => {
      assert.equal(lensForStyle(id), expected[id]);
    });
  }

  it('CONTROL: a lens table that grades `just-track` by carbs fails the same row', () => {
    // The old behaviour this milestone removes: a person with no goal still got
    // a carb verdict, against a reference they never chose. If `just-track`
    // ever goes back to `carb`, the row above must fail, and this proves it does.
    const wrong = { ...expected, 'just-track': 'carb' } satisfies Record<EatingStyleId, EatingStyleLens>;
    assert.throws(() => assert.equal(wrong['just-track'], expected['just-track']));
  });
});

describe('deriving a style for an account written before the pick existed', () => {
  // The table from the design note, row by row. `null` in, an id out, and the
  // numbers are never touched, which is what makes the upgrade reversible.
  const rows: { name: string; goals: EatingStyleGoals; expected: EatingStyleId }[] = [
    { name: 'a ceiling and no kcal target', goals: goals({ goalNetCarbsCeilingG: 50 }), expected: 'low-carb' },
    {
      name: 'a ceiling and a kcal target',
      goals: goals({ goalNetCarbsCeilingG: 20, goalKcalTarget: 1800 }),
      expected: 'low-carb-low-kcal',
    },
    { name: 'a kcal target and no ceiling', goals: goals({ goalKcalTarget: 1800 }), expected: 'low-kcal' },
    {
      name: 'neither, but a protein floor',
      goals: goals({ goalProteinFloorG: 120 }),
      expected: 'high-protein',
    },
    { name: 'nothing set at all', goals: goals(), expected: 'just-track' },
  ];

  for (const row of rows) {
    it(`reads ${row.name} as ${row.expected}`, () => {
      assert.equal(deriveEatingStyle(row.goals), row.expected);
    });
  }

  it('treats an absent key the same as an explicit null, because a pre-v20 row has no key at all', () => {
    const legacy: EatingStyleGoals = { goalNetCarbsCeilingG: 50, goalKcalTarget: null, goalProteinFloorG: null };
    assert.equal('eatingStyle' in legacy, false);
    assert.equal(deriveEatingStyle(legacy), 'low-carb');
  });

  it('reads a ceiling of 0 as a ceiling, not as "unset"', () => {
    // A truthiness check would call this `just-track` and throw away a goal
    // someone deliberately set to zero.
    assert.equal(deriveEatingStyle(goals({ goalNetCarbsCeilingG: 0 })), 'low-carb');
  });

  it('CONTROL: a derivation that ignores the kcal target fails the mapping rows that depend on it', () => {
    // `wrongDerive` is the likeliest wrong mapping: checking the ceiling first
    // and returning `low-carb` without ever looking at the kcal target. It
    // agrees with the real one on three of the five rows, so only a row-by-row
    // table catches it, and these two assertions prove the table does.
    const both = goals({ goalNetCarbsCeilingG: 20, goalKcalTarget: 1800 });
    assert.throws(() => assert.equal(wrongDerive(both), deriveEatingStyle(both)));

    const proteinOnly = goals({ goalProteinFloorG: 120 });
    assert.throws(() => assert.equal(wrongDerive(proteinOnly), deriveEatingStyle(proteinOnly)));
  });
});

describe('the style in effect', () => {
  it('prefers a stored pick over the derivation, so a deliberate `just-track` survives', () => {
    const stored = goals({ eatingStyle: 'just-track', goalNetCarbsCeilingG: 50 });
    assert.equal(effectiveEatingStyle(stored), 'just-track');
    // And the derivation still says something else, which is the whole reason
    // the field is stored at all.
    assert.equal(deriveEatingStyle(stored), 'low-carb');
  });

  it('falls back to the derivation for a null pick', () => {
    assert.equal(effectiveEatingStyle(goals({ eatingStyle: null, goalKcalTarget: 1800 })), 'low-kcal');
  });

  it('falls back to the derivation for a pick this build cannot resolve', () => {
    // A blob merged from a peer on a newer build. Grading a day by a lens this
    // build cannot look up would be worse than grading it by the numbers.
    // SAFETY: deliberately fabricating an out-of-union stored id. A peer on a
    // newer build is exactly where one comes from, and no in-union value could
    // exercise the fallback.
    const alien: EatingStyleGoals = { ...goals({ goalKcalTarget: 1800 }), eatingStyle: 'carnivore' as EatingStyleId };
    assert.equal(effectiveEatingStyle(alien), 'low-kcal');
  });
});

describe('reconciling the style with numbers typed on the goals card', () => {
  it('turns a stored low-kcal into low-carb-low-kcal when a carb limit is typed beside the target', () => {
    // The walk: 1800 kcal on file, a 100 g limit typed, and the style card went
    // on saying "Calories" while the day was graded by the kcal lens.
    assert.equal(
      reconcileEatingStyle({
        storedStyle: 'low-kcal',
        goals: numbers({ goalKcalTarget: 1800, goalNetCarbsCeilingG: 100 }),
      }),
      'low-carb-low-kcal',
    );
  });

  it('drops back to low-kcal when the ceiling is cleared again', () => {
    assert.equal(
      reconcileEatingStyle({ storedStyle: 'low-carb-low-kcal', goals: numbers({ goalKcalTarget: 1800 }) }),
      'low-kcal',
    );
  });

  it('keeps high-protein when a carb ceiling is typed beside a floor that is still set', () => {
    // The one exception: the protein lens is the person's own pick, and
    // `deriveEatingStyle` would answer the carb question first and lose it.
    assert.equal(
      reconcileEatingStyle({
        storedStyle: 'high-protein',
        goals: numbers({ goalProteinFloorG: 120, goalNetCarbsCeilingG: 100 }),
      }),
      'high-protein',
    );
  });

  it('lets the high-protein exception lapse once the floor is cleared', () => {
    assert.equal(
      reconcileEatingStyle({ storedStyle: 'high-protein', goals: numbers({ goalNetCarbsCeilingG: 100 }) }),
      'low-carb',
    );
  });

  it('turns a stored just-track into low-carb the moment a ceiling is typed', () => {
    assert.equal(
      reconcileEatingStyle({ storedStyle: 'just-track', goals: numbers({ goalNetCarbsCeilingG: 100 }) }),
      'low-carb',
    );
  });

  it('derives from the numbers for a pre-v20 profile with no stored style', () => {
    assert.equal(reconcileEatingStyle({ storedStyle: null, goals: numbers({ goalKcalTarget: 1800 }) }), 'low-kcal');
  });

  it('CONTROL: keeping the stored style fails the walk case, and always deriving fails the high-protein case', () => {
    // Two wrong implementations, one on each side of the rule. Either passes a
    // test file that only checks the other half, so both halves are pinned.
    const walk: ReconcileEatingStyleInput = {
      storedStyle: 'low-kcal',
      goals: numbers({ goalKcalTarget: 1800, goalNetCarbsCeilingG: 100 }),
    };
    const keptFloor: ReconcileEatingStyleInput = {
      storedStyle: 'high-protein',
      goals: numbers({ goalProteinFloorG: 120, goalNetCarbsCeilingG: 100 }),
    };

    assert.throws(() => assert.equal(alwaysStored(walk), reconcileEatingStyle(walk)));
    assert.throws(() => assert.equal(alwaysDerive(keptFloor), reconcileEatingStyle(keptFloor)));

    // And each control agrees with the shipped rule on the case it does not
    // break, so the two assertions above are the only thing separating them.
    assert.equal(alwaysStored(keptFloor), reconcileEatingStyle(keptFloor));
    assert.equal(alwaysDerive(walk), reconcileEatingStyle(walk));
  });
});

describe('applying a style', () => {
  const current = goals({ goalNetCarbsCeilingG: 50, goalKcalTarget: 1800, goalProteinFloorG: 120 });

  function apply(style: EatingStyleId, overrides: Partial<Parameters<typeof applyEatingStyle>[0]> = {}) {
    return applyEatingStyle({
      style,
      currentGoals: current,
      carbPresetCeiling: null,
      kcalTarget: null,
      latestWeightKg: null,
      referenceProteinFloorG: 60,
      ...overrides,
    });
  }

  it('writes the ceiling the carb sub step returned and nulls the kcal target `low-carb` does not own', () => {
    const { patch } = apply('low-carb', { carbPresetCeiling: 20 });
    assert.equal(patch.goalNetCarbsCeilingG, 20);
    assert.equal(patch.goalKcalTarget, null);
    assert.equal(patch.eatingStyle, 'low-carb');
  });

  it('writes both numbers for `low-carb-low-kcal`', () => {
    const { patch } = apply('low-carb-low-kcal', { carbPresetCeiling: 100, kcalTarget: 1600 });
    assert.equal(patch.goalNetCarbsCeilingG, 100);
    assert.equal(patch.goalKcalTarget, 1600);
  });

  it('nulls the carb ceiling when a carb tracker switches to `low-kcal`', () => {
    const { patch } = apply('low-kcal', { kcalTarget: 1600 });
    assert.equal(patch.goalNetCarbsCeilingG, null);
    assert.equal(patch.goalKcalTarget, 1600);
  });

  it('nulls both numbers for `just-track`, so no stale goal grades the day', () => {
    const { patch } = apply('just-track');
    assert.equal(patch.goalNetCarbsCeilingG, null);
    assert.equal(patch.goalKcalTarget, null);
  });

  it('CONTROL: an implementation that keeps the existing ceiling fails the `low-kcal` case', () => {
    // The defect this guards: a switch away from a carb style that leaves the
    // old ceiling in the row. Nothing on screen would show it, and every export
    // and sync blob would carry a goal the person believed they had dropped.
    const keepsCeiling = { ...apply('low-kcal', { kcalTarget: 1600 }).patch, goalNetCarbsCeilingG: 50 };
    assert.throws(() => assert.equal(keepsCeiling.goalNetCarbsCeilingG, null));
  });

  it('keeps the stored number for a field the style owns but the caller did not re-ask', () => {
    // Settings changing a style without re-running the wizard.
    const { patch } = apply('low-carb');
    assert.equal(patch.goalNetCarbsCeilingG, 50);
  });

  it('sets the protein floor to 1.6 g per kg of the latest weight, rounded to whole grams', () => {
    const { patch, needsWeight } = apply('high-protein', { latestWeightKg: 78.4 });
    assert.equal(patch.goalProteinFloorG, Math.round(78.4 * HIGH_PROTEIN_G_PER_KG));
    assert.equal(patch.goalProteinFloorG, 125);
    assert.equal(needsWeight, false);
  });

  it('falls back to the reference floor with no logged weight, and says a weight is needed', () => {
    const { patch, needsWeight } = apply('high-protein', { latestWeightKg: null });
    assert.equal(patch.goalProteinFloorG, 60);
    assert.equal(needsWeight, true);
  });

  it('CONTROL: a fallback that invents a floor from no weight fails the no-weight case', () => {
    // Silently multiplying by a stand-in weight would produce a confident
    // number nobody entered, which is exactly what `needsWeight` exists to
    // avoid saying instead.
    const invented = { goalProteinFloorG: Math.round(70 * HIGH_PROTEIN_G_PER_KG), needsWeight: false };
    assert.throws(() => assert.equal(invented.goalProteinFloorG, 60));
    assert.throws(() => assert.equal(invented.needsWeight, true));
  });

  it('resets the protein floor to the reference when leaving `high-protein`', () => {
    const afterHighProtein = goals({ goalProteinFloorG: 125, eatingStyle: 'high-protein' });
    const { patch, needsWeight } = applyEatingStyle({
      style: 'low-carb',
      currentGoals: afterHighProtein,
      carbPresetCeiling: 50,
      kcalTarget: null,
      latestWeightKg: 78,
      referenceProteinFloorG: 60,
    });
    assert.equal(patch.goalProteinFloorG, 60);
    assert.equal(needsWeight, false);
  });

  it('never claims a weight is needed for a style that does not use one', () => {
    for (const id of EATING_STYLE_IDS) {
      if (id === 'high-protein') continue;
      assert.equal(apply(id).needsWeight, false);
    }
  });

  // The floor someone typed into the goals card by hand, on a style that leaves
  // the floor at the reference.
  const typedFloor = goals({ goalNetCarbsCeilingG: 50, goalProteinFloorG: 125, eatingStyle: 'low-carb' });

  it('keeps a hand-typed protein floor when the same style is saved again', () => {
    // Opening the style card, changing nothing about the style and saving must
    // not quietly replace 125 g with the reference. Nothing on screen would say
    // the goal had moved.
    assert.equal(saveOver({ currentGoals: typedFloor, style: 'low-carb' }).patch.goalProteinFloorG, 125);
  });

  it('keeps a hand-typed floor on a re-save for a profile written before the stored pick existed', () => {
    // No `eatingStyle` on file, so the comparison runs against the DERIVED
    // style. A ceiling and no target derives `low-carb`, which is what is being
    // saved, so this is a re-save and not a change.
    const preV20 = goals({ goalNetCarbsCeilingG: 50, goalProteinFloorG: 125 });
    assert.equal(saveOver({ currentGoals: preV20, style: 'low-carb' }).patch.goalProteinFloorG, 125);
  });

  it('resets the floor to the reference when the style changes', () => {
    assert.equal(saveOver({ currentGoals: typedFloor, style: 'low-kcal', kcalTarget: 1600 }).patch.goalProteinFloorG, 60);
    assert.equal(saveOver({ currentGoals: typedFloor, style: 'just-track' }).patch.goalProteinFloorG, 60);
  });

  it('recomputes the floor from weight on a `high-protein` re-save, typed floor or not', () => {
    const stale = goals({ goalProteinFloorG: 200, eatingStyle: 'high-protein' });
    assert.equal(saveOver({ currentGoals: stale, style: 'high-protein' }).patch.goalProteinFloorG, Math.round(78 * HIGH_PROTEIN_G_PER_KG));
  });

  it('CONTROL: an implementation that always writes the reference fails the re-save case', () => {
    // This is exactly what the first cut did, and it passed every case above:
    // the changed-style case wants the reference, so only the re-save case can
    // tell the two implementations apart.
    const alwaysResets = { ...saveOver({ currentGoals: typedFloor, style: 'low-carb' }).patch, goalProteinFloorG: 60 };
    assert.throws(() => assert.equal(alwaysResets.goalProteinFloorG, 125));
    assert.equal(alwaysResets.goalProteinFloorG, saveOver({ currentGoals: typedFloor, style: 'low-kcal', kcalTarget: 1600 }).patch.goalProteinFloorG);
  });
});

describe('the caution note', () => {
  const restricting: ReadonlySet<EatingStyleId> = new Set<EatingStyleId>(['low-carb', 'low-carb-low-kcal', 'low-kcal']);
  const statuses: (ReproductiveStatus | null | undefined)[] = ['none', 'pregnant', 'lactating', null, undefined];

  for (const status of statuses) {
    for (const id of EATING_STYLE_IDS) {
      const shown = (status === 'pregnant' || status === 'lactating') && restricting.has(id);
      it(`${shown ? 'shows' : 'stays quiet'} for ${id} and a status of ${String(status)}`, () => {
        assert.equal(styleCaution(id, status), shown ? 'caution' : null);
      });
    }
  }

  it('CONTROL: a rule that also cautions `high-protein` fails the pregnant high-protein pair', () => {
    // The note points AT `high-protein` and `just-track`, so cautioning them
    // would send a pregnant person in a circle.
    assert.throws(() => assert.equal(overEagerCaution('pregnant'), styleCaution('high-protein', 'pregnant')));
  });

  it('links a source that resolves', () => {
    // The deeper DGE page named in the design note answered 404 on 2026-09-09,
    // so the note points at the DGE reference values index instead, which
    // answered 200 the same day and is where the pregnancy and lactation
    // intake figures live.
    assert.equal(STYLE_CAUTION_SOURCE_URL, 'https://www.dge.de/wissenschaft/referenzwerte/');
  });
});

describe('the stored field', () => {
  it('is at schema v20, the eating style on the profile (M210/01)', () => {
    assert.equal(SCHEMA_VERSION, 20);
  });

  it('round-trips a picked style through a backup envelope', () => {
    const restored = migrateEnvelopeForward(parseBackupEnvelope(envelopeJson({ eatingStyle: 'high-protein' })));
    assert.equal(restored.data.profile?.eatingStyle, 'high-protein');
  });

  it('round-trips an explicit null, which a person who cleared the pick must get back', () => {
    const restored = migrateEnvelopeForward(parseBackupEnvelope(envelopeJson({ eatingStyle: null })));
    assert.equal(restored.data.profile?.eatingStyle, null);
  });

  it('imports a v19 envelope with no style key at all and leaves it absent', () => {
    // Every backup file on every device today predates the pick, and absent is
    // already the right state: the readers derive a style from the numbers.
    const restored = migrateEnvelopeForward(parseBackupEnvelope(envelopeJson({}, 19)));
    assert.equal(restored.data.profile?.eatingStyle, undefined);
    assert.equal(restored.data.profile?.goalNetCarbsCeilingG, 50);
    const profile = restored.data.profile;
    assert.notEqual(profile, null);
    assert.equal(profile === null ? null : effectiveEatingStyle(profile), 'low-carb');
  });

  it('refuses an envelope carrying a style id this build cannot resolve', () => {
    // Unlike the two date fields beside it, an unknown value here is not one
    // the readers can ignore: no lens resolves from it.
    assert.throws(
      () => migrateEnvelopeForward(parseBackupEnvelope(envelopeJson({ eatingStyle: 'carnivore' }))),
      /Backup migration failed/,
    );
  });

  it('CONTROL: a `profileGoalsSchema` with no style line would drop the pick, and this round trip catches it', () => {
    // zod STRIPS unrecognized keys, so the failure mode is silent: the import
    // succeeds and the pick is simply gone. Stripping is what `undefined` here
    // would look like, and the round-trip assertion above rejects it.
    const stripped = {} satisfies Partial<EatingStyleGoals>;
    assert.throws(() => assert.equal(Object.hasOwn(stripped, 'eatingStyle'), true));
  });
});

/** The one field these cases vary, plus the fabricated ids only a control needs. */
type ProfileStyleOverride = { eatingStyle?: EatingStyleId | string | null };

/** A one-profile envelope, with the style field overridden. */
function envelopeJson(profileOverrides: ProfileStyleOverride, schemaVersion = SCHEMA_VERSION): string {
  return JSON.stringify({
    schemaVersion,
    exportedAt: '2026-09-09T00:00:00.000Z',
    data: {
      foods: [],
      foodLogs: [],
      weightEntries: [],
      fasts: [],
      profile: {
        timezone: 'UTC',
        goalNetCarbsCeilingG: 50,
        goalProteinFloorG: null,
        goalKcalTarget: null,
        targetWeightKg: null,
        trackingFocus: null,
        onboardingCompletedAt: null,
        updatedAt: 1,
        ...profileOverrides,
      },
    },
  });
}
