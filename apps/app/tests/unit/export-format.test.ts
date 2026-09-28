/**
 * Unit tests for `#app/lib/export-format` — the pure serialization core behind
 * the data-export route. No DB import (the shell in `export.server` owns that),
 * so these run without a database connection.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExportDocument,
  buildExportFilename,
  buildFoodsCsv,
  buildLogsCsv,
  buildWeightsCsv,
  computeExportNetCarbs,
  EXPORT_SCHEMA_VERSION,
  isExportFormat,
  isExportWhat,
} from '../../app/lib/export-format';
import type {
  ExportFoodInput,
  ExportLogInput,
  ExportProfileInput,
  ExportWeightInput,
} from '../../app/lib/export-format';

const CRLF = '\r\n';

/** Joins a header line and pre-rendered data-cell rows into an expected CSV string. */
function expectedCsv(header: string, rows: string[][]): string {
  return [header, ...rows.map((cells) => cells.join(','))].join(CRLF);
}

const LOG_HEADER =
  'logged_at,name,quantity_grams,carbs,fiber,sugars,polyols,protein,fat,kcal,net_carbs,meal,source,ai_estimated,curated_source';
const FOOD_HEADER = 'name,brand,carbs,fiber,sugars,polyols,protein,fat,kcal,net_carbs,source,created_at';
const WEIGHT_HEADER = 'measured_at,weight_kg';

function makeLog(overrides: Partial<ExportLogInput> = {}): ExportLogInput {
  return {
    id: 1,
    loggedAt: new Date('2026-07-13T08:30:00.000Z'),
    name: 'Oatmeal',
    quantityGrams: 200,
    carbs: 27,
    fiber: 4,
    sugars: 1,
    polyols: null,
    protein: 5,
    fat: 3,
    kcal: 150,
    mealType: 'breakfast',
    source: 'manual',
    aiEstimated: false,
    curatedSource: null,
    foodId: null,
    logBatchId: null,
    ...overrides,
  };
}

function makeFood(overrides: Partial<ExportFoodInput> = {}): ExportFoodInput {
  return {
    id: 7,
    name: 'Cheddar',
    brand: null,
    carbs: 1.3,
    fiber: 0,
    sugars: 0.5,
    polyols: null,
    protein: 25,
    fat: 33,
    kcal: 402,
    source: 'user',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeWeight(overrides: Partial<ExportWeightInput> = {}): ExportWeightInput {
  return { measuredAt: '2026-07-13', weightKg: 82.4, ...overrides };
}

function makeProfile(overrides: Partial<ExportProfileInput> = {}): ExportProfileInput {
  return {
    timezone: 'Europe/Berlin',
    goalNetCarbsCeilingG: 20,
    goalProteinFloorG: 120,
    goalKcalTarget: 2000,
    targetWeightKg: 78,
    trackingFocus: 'net-carbs',
    ...overrides,
  };
}

describe('computeExportNetCarbs', () => {
  it('subtracts fiber and polyols from carbs', () => {
    assert.strictEqual(computeExportNetCarbs({ carbs: 30, fiber: 6, polyols: 4 }), 20);
  });

  it('treats unknown fiber/polyols as 0 (matching the daily-totals convention)', () => {
    assert.strictEqual(computeExportNetCarbs({ carbs: 10, fiber: null, polyols: null }), 10);
  });

  it('returns null when carbs is unknown (never fabricates 0)', () => {
    assert.strictEqual(computeExportNetCarbs({ carbs: null, fiber: 2, polyols: 1 }), null);
  });

  it('is not clamped — a fiber-heavy entry can go negative', () => {
    assert.strictEqual(computeExportNetCarbs({ carbs: 2, fiber: 5, polyols: 0 }), -3);
  });
});

describe('isExportFormat / isExportWhat', () => {
  it('accepts the supported formats and rejects others', () => {
    assert.strictEqual(isExportFormat('csv'), true);
    assert.strictEqual(isExportFormat('json'), true);
    assert.strictEqual(isExportFormat('xml'), false);
    assert.strictEqual(isExportFormat(''), false);
  });

  it('accepts the supported selections and rejects others', () => {
    for (const what of ['logs', 'foods', 'weights', 'all']) {
      assert.strictEqual(isExportWhat(what), true);
    }
    assert.strictEqual(isExportWhat('everything'), false);
    assert.strictEqual(isExportWhat(''), false);
  });
});

describe('buildExportFilename', () => {
  it('builds a dated, entity-scoped filename', () => {
    assert.strictEqual(
      buildExportFilename({ what: 'logs', format: 'csv', date: '2026-07-13' }),
      'openplate-logs-2026-07-13.csv',
    );
    assert.strictEqual(
      buildExportFilename({ what: 'all', format: 'json', date: '2026-07-13' }),
      'openplate-all-2026-07-13.json',
    );
  });
});

describe('buildLogsCsv', () => {
  it('emits only the header for an empty log set', () => {
    assert.strictEqual(buildLogsCsv([]), LOG_HEADER);
  });

  it('serializes a full row with an ISO timestamp and computed net carbs', () => {
    const csv = buildLogsCsv([makeLog()]);

    // logged_at, name, quantity_grams, carbs, fiber, sugars, polyols, protein,
    // fat, kcal, net_carbs, meal, source, ai_estimated, curated_source
    const cells = [
      '2026-07-13T08:30:00.000Z',
      'Oatmeal',
      '200',
      '27',
      '4',
      '1',
      '',
      '5',
      '3',
      '150',
      '23',
      'breakfast',
      'manual',
      'false',
      '',
    ];
    assert.strictEqual(csv, expectedCsv(LOG_HEADER, [cells]));
  });

  it('leaves unknown macros as empty cells and net_carbs empty when carbs is unknown', () => {
    const csv = buildLogsCsv([
      makeLog({ carbs: null, fiber: null, sugars: null, polyols: null, protein: null, fat: null, kcal: null }),
    ]);

    const cells = [
      '2026-07-13T08:30:00.000Z',
      'Oatmeal',
      '200',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'breakfast',
      'manual',
      'false',
      '',
    ];
    assert.strictEqual(csv, expectedCsv(LOG_HEADER, [cells]));
  });

  it('carries the meal, curated source, and ai_estimated flag through', () => {
    const csv = buildLogsCsv([makeLog({ mealType: null, curatedSource: 'lowcarbcheck:acerola', aiEstimated: true })]);

    const cells = [
      '2026-07-13T08:30:00.000Z',
      'Oatmeal',
      '200',
      '27',
      '4',
      '1',
      '',
      '5',
      '3',
      '150',
      '23',
      '',
      'manual',
      'true',
      'lowcarbcheck:acerola',
    ];
    assert.strictEqual(csv.split(CRLF)[1], cells.join(','));
  });

  it('hardens a malicious food name against formula injection', () => {
    const csv = buildLogsCsv([makeLog({ name: '=2+2' })]);

    const dataLine = csv.split(CRLF)[1];
    assert.ok(dataLine !== undefined && dataLine.startsWith("2026-07-13T08:30:00.000Z,'=2+2,"));
  });
});

describe('buildFoodsCsv', () => {
  it('emits only the header for an empty food set', () => {
    assert.strictEqual(buildFoodsCsv([]), FOOD_HEADER);
  });

  it('serializes a per-100g food row with computed net carbs and an empty brand', () => {
    const csv = buildFoodsCsv([makeFood()]);

    // name, brand, carbs, fiber, sugars, polyols, protein, fat, kcal, net_carbs, source, created_at
    const cells = ['Cheddar', '', '1.3', '0', '0.5', '', '25', '33', '402', '1.3', 'user', '2026-07-01T00:00:00.000Z'];
    assert.strictEqual(csv, expectedCsv(FOOD_HEADER, [cells]));
  });
});

describe('buildWeightsCsv', () => {
  it('serializes weigh-ins with a header', () => {
    const csv = buildWeightsCsv([makeWeight(), makeWeight({ measuredAt: '2026-07-12', weightKg: 82.9 })]);

    assert.strictEqual(
      csv,
      expectedCsv(WEIGHT_HEADER, [
        ['2026-07-13', '82.4'],
        ['2026-07-12', '82.9'],
      ]),
    );
  });
});

describe('buildExportDocument', () => {
  it('assembles the full document with numbers as numbers and ISO dates', () => {
    const document = buildExportDocument({
      exportedAt: new Date('2026-07-13T10:00:00.000Z'),
      profile: makeProfile(),
      foods: [makeFood()],
      logs: [makeLog()],
      weights: [makeWeight()],
    });

    assert.deepStrictEqual(document, {
      exportedAt: '2026-07-13T10:00:00.000Z',
      schemaVersion: EXPORT_SCHEMA_VERSION,
      profile: {
        timezone: 'Europe/Berlin',
        goals: {
          netCarbsCeilingG: 20,
          proteinFloorG: 120,
          kcalTarget: 2000,
          trackingFocus: 'net-carbs',
        },
        targetWeightKg: 78,
      },
      foods: [
        {
          id: 7,
          name: 'Cheddar',
          brand: null,
          carbs: 1.3,
          fiber: 0,
          sugars: 0.5,
          polyols: null,
          protein: 25,
          fat: 33,
          kcal: 402,
          netCarbs: 1.3,
          carbBasis: undefined,
          source: 'user',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      logs: [
        {
          id: 1,
          loggedAt: '2026-07-13T08:30:00.000Z',
          name: 'Oatmeal',
          quantityGrams: 200,
          carbs: 27,
          fiber: 4,
          sugars: 1,
          polyols: null,
          protein: 5,
          fat: 3,
          kcal: 150,
          netCarbs: 23,
          carbBasis: undefined,
          mealType: 'breakfast',
          source: 'manual',
          aiEstimated: false,
          curatedSource: null,
          foodId: null,
          logBatchId: null,
        },
      ],
      weights: [{ measuredAt: '2026-07-13', weightKg: 82.4 }],
    });
  });

  it('keeps unset profile goals null rather than defaulting them to 0', () => {
    const document = buildExportDocument({
      exportedAt: new Date('2026-07-13T10:00:00.000Z'),
      profile: makeProfile({
        goalNetCarbsCeilingG: null,
        goalProteinFloorG: null,
        goalKcalTarget: null,
        targetWeightKg: null,
        trackingFocus: null,
      }),
      foods: [],
      logs: [],
      weights: [],
    });

    assert.deepStrictEqual(document.profile.goals, {
      netCarbsCeilingG: null,
      proteinFloorG: null,
      kcalTarget: null,
      trackingFocus: null,
    });
    assert.strictEqual(document.profile.targetWeightKg, null);
  });
});
