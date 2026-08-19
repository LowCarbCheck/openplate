/**
 * Unit tests for the LowCarbCheck food-resolution service. Covers the pure
 * parse/filter/apply helpers and the fail-open `resolveIdentifiedFoods` shell
 * (with `fetch` stubbed — no real network calls). The overriding property
 * under test is FAIL OPEN: every failure mode must degrade to empty matches,
 * never a throw.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveIdentifiedFoods,
  parseFoodSearchResponse,
  filterViableMatches,
  FoodResolutionParseError,
  SCORE_FLOOR,
  clearFoodResolutionCache,
  MAX_CACHE_ENTRIES,
  allNamesCached,
} from '../../app/services/food-resolution';
import { matchMacrosToFormValues, toCuratedSource } from '../../app/services/food-resolution/apply-match';

const originalFetch = globalThis.fetch;

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  // SAFETY: `typeof fetch` carries extras (e.g. `preconnect`) that nothing under test
  // touches; the code being exercised only ever calls `fetch(input, init)`, which `impl`
  // implements exactly.
  globalThis.fetch = impl as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

interface RawResultOverrides {
  slug?: string;
  score?: number;
  imageUrl?: string | null;
  netCarbsPer100g?: number | null;
  origin?: string | null;
  portionSize?: number | null;
}

function buildRawResult(overrides: RawResultOverrides = {}) {
  return {
    slug: overrides.slug ?? 'chicken-breast',
    locale: 'en',
    title: 'Chicken breast',
    canonicalName: 'Chicken breast',
    url: 'https://lowcarbcheck.org/en/foods/chicken-breast',
    imageUrl: overrides.imageUrl ?? 'https://lowcarbcheck.org/img/chicken.jpg',
    macrosPer100g: { kcal: 165, protein: 31, fat: 3.6, carbs: 0, fiber: null, sugars: 0, polyols: null },
    netCarbsPer100g: overrides.netCarbsPer100g ?? 0,
    score: overrides.score ?? 0.92,
    origin: overrides.origin ?? 'curated',
    portionSize: overrides.portionSize ?? null,
  };
}

const ENABLED = { enabled: true, apiUrl: 'https://lcc.test' } as const;

describe('parseFoodSearchResponse', () => {
  it('maps a valid response into owned FoodMatch objects', () => {
    const matches = parseFoodSearchResponse({ results: [buildRawResult()] });

    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0]?.slug, 'chicken-breast');
    assert.strictEqual(matches[0]?.macrosPer100g.kcal, 165);
    assert.strictEqual(matches[0]?.macrosPer100g.fiber, null);
    assert.strictEqual(matches[0]?.score, 0.92);
  });

  it('parses the pre-rollout shape (url present, attribution absent) and normalizes attribution to null', () => {
    // buildRawResult() intentionally omits `attribution` — the currently-deployed
    // API shape. Resolution must keep working (fail-open must not trip) and the
    // absent field must surface as null, not undefined.
    const [match] = parseFoodSearchResponse({ results: [buildRawResult()] });

    assert.strictEqual(match?.url, 'https://lowcarbcheck.org/en/foods/chicken-breast');
    assert.strictEqual(match?.attribution, null);
  });

  it('parses the BLS shape (url null + attribution present)', () => {
    const attribution = 'Bundeslebensmittelschlüssel (BLS) 4.0 — Max Rubner-Institut, CC BY 4.0 (adapted)';
    const blsResult = { ...buildRawResult({ slug: 'apple-generic' }), url: null, attribution };

    const [match] = parseFoodSearchResponse({ results: [blsResult] });

    assert.strictEqual(match?.slug, 'apple-generic');
    assert.strictEqual(match?.url, null);
    assert.strictEqual(match?.attribution, attribution);
  });

  it('parses origin/portionSize when present', () => {
    const raw = { ...buildRawResult({ origin: 'bls' }), portionSize: 150 };
    const [match] = parseFoodSearchResponse({ results: [raw] });

    assert.strictEqual(match?.origin, 'bls');
    assert.strictEqual(match?.portionSize, 150);
  });

  it('defaults origin/portionSize to null on the pre-rollout API shape (fields absent entirely)', () => {
    const preRollout = buildRawResult();
    // @ts-expect-error deliberately simulating a response from before these fields shipped
    delete preRollout.origin;
    // @ts-expect-error deliberately simulating a response from before these fields shipped
    delete preRollout.portionSize;

    const [match] = parseFoodSearchResponse({ results: [preRollout] });

    assert.strictEqual(match?.origin, null);
    assert.strictEqual(match?.portionSize, null);
  });

  it('tolerates an origin value it does not recognize (forward-compatible, never fails validation)', () => {
    const raw = buildRawResult({ origin: 'some-future-origin' });
    const [match] = parseFoodSearchResponse({ results: [raw] });

    assert.strictEqual(match?.origin, 'some-future-origin');
  });

  it('ignores unknown fields on results (forward-compatible with the API)', () => {
    const withExtras = { ...buildRawResult(), extraField: 'ignored', anotherOne: 42 };
    const matches = parseFoodSearchResponse({ results: [withExtras] });

    assert.strictEqual(matches.length, 1);
    const [first] = matches;
    assert.ok(first !== undefined);
    assert.ok(!('extraField' in first));
  });

  it('throws FoodResolutionParseError when the shape does not match', () => {
    assert.throws(() => parseFoodSearchResponse({ oops: true }), FoodResolutionParseError);
  });

  it('throws FoodResolutionParseError when a macro field is the wrong type', () => {
    const bad = { ...buildRawResult(), macrosPer100g: { ...buildRawResult().macrosPer100g, kcal: 'lots' } };
    assert.throws(() => parseFoodSearchResponse({ results: [bad] }), FoodResolutionParseError);
  });
});

describe('filterViableMatches', () => {
  it('drops matches below the score floor and keeps the rest in order', () => {
    const matches = parseFoodSearchResponse({
      results: [
        buildRawResult({ slug: 'good', score: 0.9 }),
        buildRawResult({ slug: 'weak', score: 0.2 }),
        buildRawResult({ slug: 'borderline', score: SCORE_FLOOR }),
      ],
    });

    const viable = filterViableMatches(matches);

    assert.deepStrictEqual(
      viable.map((match) => match.slug),
      ['good', 'borderline'],
    );
  });

  it('honors a custom floor', () => {
    const matches = parseFoodSearchResponse({
      results: [buildRawResult({ slug: 'a', score: 0.6 }), buildRawResult({ slug: 'b', score: 0.8 })],
    });

    assert.deepStrictEqual(
      filterViableMatches(matches, 0.7).map((match) => match.slug),
      ['b'],
    );
  });

  // Regression (M123): LCC lowered its fuzzy-only score ceiling from 0.65 to
  // 0.35 so a pure-fuzzy (typo) hit could never outrank a genuine lexical
  // hit — but that pushed every fuzzy score below the single flat
  // SCORE_FLOOR (0.45) that used to admit both populations, so a misspelled
  // food (e.g. "brocoli") could no longer surface ANY match. Fixed with a
  // second, lower floor (FUZZY_SCORE_FLOOR) for the guaranteed-fuzzy-only
  // band (score < 0.4) — see schema.ts's FUZZY_BAND_BOUNDARY doc comment.
  it('admits a fuzzy-only score above FUZZY_SCORE_FLOOR even though it is below LEXICAL_SCORE_FLOOR', () => {
    const matches = parseFoodSearchResponse({
      // 0.3429 mirrors the real "brocoli" -> "Broccoli" score measured
      // against the live LCC content index.
      results: [buildRawResult({ slug: 'broccoli', score: 0.3429 })],
    });

    assert.deepStrictEqual(
      filterViableMatches(matches).map((match) => match.slug),
      ['broccoli'],
    );
  });

  it('still drops a fuzzy-only score below FUZZY_SCORE_FLOOR (the "nutella" -> "lemon grass" case)', () => {
    const matches = parseFoodSearchResponse({
      // 0.25 mirrors the real "nutella" -> "Lemon grass" score measured
      // against the live LCC content index — the exact production
      // regression a fuzzy-aware floor must keep filtered out.
      results: [buildRawResult({ slug: 'lemon-grass', score: 0.25 })],
    });

    assert.deepStrictEqual(filterViableMatches(matches), []);
  });

  it('still drops a weak lexical-tier score between the two floors (unaffected by the fuzzy-band fix)', () => {
    // 0.42 sits in LCC's token-overlap lexical tier (0.4..0.55) but below
    // LEXICAL_SCORE_FLOOR (0.45) — a genuine but weak lexical match, not a
    // fuzzy one. The two-band split must not accidentally loosen this.
    const matches = parseFoodSearchResponse({
      results: [buildRawResult({ slug: 'weak-lexical', score: 0.42 })],
    });

    assert.deepStrictEqual(filterViableMatches(matches), []);
  });
});

describe('matchMacrosToFormValues', () => {
  it('stringifies present numbers and leaves nulls as empty strings (never 0)', () => {
    const values = matchMacrosToFormValues({
      kcal: 165,
      protein: 31,
      fat: 3.6,
      carbs: 0,
      fiber: null,
      sugars: 0,
      polyols: null,
    });

    assert.strictEqual(values.kcal, '165');
    assert.strictEqual(values.carbs, '0');
    assert.strictEqual(values.fat, '3.6');
    assert.strictEqual(values.fiber, '');
    assert.strictEqual(values.polyols, '');
  });
});

describe('toCuratedSource', () => {
  it('builds the lowcarbcheck provenance token from a slug', () => {
    assert.strictEqual(toCuratedSource('chicken-breast'), 'lowcarbcheck:chicken-breast');
  });
});

describe('resolveIdentifiedFoods', () => {
  // The search cache is process-wide (by design, M123/05) — reset it before
  // every test so cases don't leak into each other via a shared name/apiUrl.
  beforeEach(() => {
    clearFoodResolutionCache();
  });

  it('returns viable matches parallel to the input foods on success', async () => {
    stubFetch(async () => new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 }));
    try {
      const matches = await resolveIdentifiedFoods([{ name: 'chicken breast' }], ENABLED);
      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0]?.length, 1);
      assert.strictEqual(matches[0]?.[0]?.slug, 'chicken-breast');
    } finally {
      restoreFetch();
    }
  });

  it('filters out below-floor matches before returning', async () => {
    stubFetch(async () => new Response(JSON.stringify({ results: [buildRawResult({ score: 0.1 })] }), { status: 200 }));
    try {
      const matches = await resolveIdentifiedFoods([{ name: 'mystery' }], ENABLED);
      assert.deepStrictEqual(matches, [[]]);
    } finally {
      restoreFetch();
    }
  });

  it('POSTs q/locale/limit in a JSON body — never in the URL query string', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    stubFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    try {
      await resolveIdentifiedFoods([{ name: 'chicken breast' }], ENABLED);
      const parsed = new URL(capturedUrl);
      assert.strictEqual(parsed.pathname, '/api/v1/foods/search');
      // The search term must never land in the URL (Traefik access-log leak).
      assert.strictEqual(parsed.search, '');
      assert.strictEqual(capturedInit?.method, 'POST');
      const body = JSON.parse(String(capturedInit?.body));
      assert.strictEqual(body.q, 'chicken breast');
      assert.strictEqual(body.locale, 'en');
      // Matches the LCC search API's own maximum (1-10); previously capped at
      // 3, throwing away candidates the server was willing to rank (M123/04).
      assert.strictEqual(body.limit, 10);
    } finally {
      restoreFetch();
    }
  });

  it('fails open (empty arrays) when fetch throws — network error / timeout', async () => {
    stubFetch(async () => {
      throw new Error('The operation was aborted');
    });
    try {
      const matches = await resolveIdentifiedFoods([{ name: 'a' }, { name: 'b' }], ENABLED);
      assert.deepStrictEqual(matches, [[], []]);
    } finally {
      restoreFetch();
    }
  });

  it('fails open on a non-OK HTTP status (e.g. 429)', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }));
    try {
      const matches = await resolveIdentifiedFoods([{ name: 'a' }], ENABLED);
      assert.deepStrictEqual(matches, [[]]);
    } finally {
      restoreFetch();
    }
  });

  it('fails open on a non-JSON body', async () => {
    stubFetch(async () => new Response('<html>not json</html>', { status: 200 }));
    try {
      const matches = await resolveIdentifiedFoods([{ name: 'a' }], ENABLED);
      assert.deepStrictEqual(matches, [[]]);
    } finally {
      restoreFetch();
    }
  });

  it('fails open on a well-formed JSON body that does not match the contract', async () => {
    stubFetch(async () => new Response(JSON.stringify({ totally: 'wrong' }), { status: 200 }));
    try {
      const matches = await resolveIdentifiedFoods([{ name: 'a' }], ENABLED);
      assert.deepStrictEqual(matches, [[]]);
    } finally {
      restoreFetch();
    }
  });

  it('returns empty matches and makes no request when the integration is disabled', async () => {
    let called = false;
    stubFetch(async () => {
      called = true;
      return new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 });
    });
    try {
      const matches = await resolveIdentifiedFoods([{ name: 'a' }, { name: 'b' }], { enabled: false, apiUrl: '' });
      assert.deepStrictEqual(matches, [[], []]);
      assert.strictEqual(called, false);
    } finally {
      restoreFetch();
    }
  });

  it('returns an empty array for an empty food list without calling fetch', async () => {
    let called = false;
    stubFetch(async () => {
      called = true;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
    try {
      const matches = await resolveIdentifiedFoods([], ENABLED);
      assert.deepStrictEqual(matches, []);
      assert.strictEqual(called, false);
    } finally {
      restoreFetch();
    }
  });

  describe('search cache (M123/05 — reducing wasted requests)', () => {
    it('serves a repeated lookup for the same name from cache, without a second fetch', async () => {
      let fetchCallCount = 0;
      stubFetch(async () => {
        fetchCallCount += 1;
        return new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 });
      });
      try {
        const first = await resolveIdentifiedFoods([{ name: 'chicken breast' }], ENABLED);
        const second = await resolveIdentifiedFoods([{ name: 'chicken breast' }], ENABLED);
        assert.strictEqual(fetchCallCount, 1, 'the second identical lookup must be served from cache');
        assert.deepStrictEqual(second, first);
      } finally {
        restoreFetch();
      }
    });

    it('normalizes trivial formatting differences onto the same cache entry (trim/case/whitespace)', async () => {
      let fetchCallCount = 0;
      stubFetch(async () => {
        fetchCallCount += 1;
        return new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 });
      });
      try {
        await resolveIdentifiedFoods([{ name: 'Chicken Breast' }], ENABLED);
        await resolveIdentifiedFoods([{ name: '  chicken   breast  ' }], ENABLED);
        assert.strictEqual(fetchCallCount, 1, '"Chicken Breast" and "  chicken   breast  " must share one cache entry');
      } finally {
        restoreFetch();
      }
    });

    it('dedupes concurrent identical lookups into a single upstream call (e.g. the same food twice on one plate)', async () => {
      let fetchCallCount = 0;
      stubFetch(async () => {
        fetchCallCount += 1;
        return new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 });
      });
      try {
        const matches = await resolveIdentifiedFoods(
          [{ name: 'chicken breast' }, { name: 'chicken breast' }, { name: 'rice' }],
          ENABLED,
        );
        assert.strictEqual(fetchCallCount, 2, 'two distinct names should mean two fetches, not three');
        assert.strictEqual(matches.length, 3);
        assert.deepStrictEqual(matches[0], matches[1]);
      } finally {
        restoreFetch();
      }
    });

    it('does not share cache entries across a different apiUrl', async () => {
      let fetchCallCount = 0;
      stubFetch(async () => {
        fetchCallCount += 1;
        return new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 });
      });
      try {
        await resolveIdentifiedFoods([{ name: 'chicken breast' }], ENABLED);
        await resolveIdentifiedFoods([{ name: 'chicken breast' }], { enabled: true, apiUrl: 'https://other-lcc.test' });
        assert.strictEqual(fetchCallCount, 2, 'a different apiUrl must not hit the first apiUrl\'s cache entry');
      } finally {
        restoreFetch();
      }
    });

    it('a cleared cache asks LCC again for a name it had already resolved', async () => {
      let fetchCallCount = 0;
      stubFetch(async () => {
        fetchCallCount += 1;
        return new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 });
      });
      try {
        await resolveIdentifiedFoods([{ name: 'chicken breast' }], ENABLED);
        clearFoodResolutionCache();
        await resolveIdentifiedFoods([{ name: 'chicken breast' }], ENABLED);
        assert.strictEqual(fetchCallCount, 2);
      } finally {
        restoreFetch();
      }
    });

    // M123/06 review fix: a fail-open outcome (network error, non-OK status,
    // non-JSON body, or a validation failure) must never be cached — caching
    // it would let one transient LCC blip poison the shared cache with a
    // false "no such food" for the full 5-minute TTL, for every caller.
    describe('a failed lookup is never cached (M123/06)', () => {
      it('retries on the next call after a network error, rather than serving a cached empty result', async () => {
        let fetchCallCount = 0;
        stubFetch(async () => {
          fetchCallCount += 1;
          throw new Error('network down');
        });
        try {
          const first = await resolveIdentifiedFoods([{ name: 'transient failure food' }], ENABLED);
          const second = await resolveIdentifiedFoods([{ name: 'transient failure food' }], ENABLED);
          assert.deepStrictEqual(first, [[]]);
          assert.deepStrictEqual(second, [[]]);
          assert.strictEqual(fetchCallCount, 2, 'a network failure must not be cached — the second call must retry');
        } finally {
          restoreFetch();
        }
      });

      it('retries on the next call after a non-OK HTTP status', async () => {
        let fetchCallCount = 0;
        stubFetch(async () => {
          fetchCallCount += 1;
          return new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
        });
        try {
          await resolveIdentifiedFoods([{ name: 'blip food' }], ENABLED);
          await resolveIdentifiedFoods([{ name: 'blip food' }], ENABLED);
          assert.strictEqual(fetchCallCount, 2, 'a non-OK status must not be cached');
        } finally {
          restoreFetch();
        }
      });

      it('retries on the next call after a non-JSON body', async () => {
        let fetchCallCount = 0;
        stubFetch(async () => {
          fetchCallCount += 1;
          return new Response('<html>not json</html>', { status: 200 });
        });
        try {
          await resolveIdentifiedFoods([{ name: 'html blip food' }], ENABLED);
          await resolveIdentifiedFoods([{ name: 'html blip food' }], ENABLED);
          assert.strictEqual(fetchCallCount, 2, 'a non-JSON body must not be cached');
        } finally {
          restoreFetch();
        }
      });

      it('retries on the next call after a schema-validation failure', async () => {
        let fetchCallCount = 0;
        stubFetch(async () => {
          fetchCallCount += 1;
          return new Response(JSON.stringify({ totally: 'wrong' }), { status: 200 });
        });
        try {
          await resolveIdentifiedFoods([{ name: 'malformed blip food' }], ENABLED);
          await resolveIdentifiedFoods([{ name: 'malformed blip food' }], ENABLED);
          assert.strictEqual(fetchCallCount, 2, 'a validation failure must not be cached');
        } finally {
          restoreFetch();
        }
      });

      it('still caches a GENUINE empty result (real "no match", not a failure)', async () => {
        let fetchCallCount = 0;
        stubFetch(async () => {
          fetchCallCount += 1;
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        });
        try {
          await resolveIdentifiedFoods([{ name: 'genuinely nonexistent food' }], ENABLED);
          await resolveIdentifiedFoods([{ name: 'genuinely nonexistent food' }], ENABLED);
          assert.strictEqual(
            fetchCallCount,
            1,
            'a real empty search result is a genuine outcome and should still be cached',
          );
        } finally {
          restoreFetch();
        }
      });
    });

    // M123/06 review fix: the cache is a bounded, process-lifetime Map with
    // least-recently-used eviction, not an unbounded one.
    describe('the cache is bounded (M123/06)', () => {
      it(`evicts the least-recently-used entry once more than ${MAX_CACHE_ENTRIES} distinct names are cached`, async () => {
        let fetchCallCount = 0;
        stubFetch(async () => {
          fetchCallCount += 1;
          return new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 });
        });
        try {
          // Sequential (not fanned out via resolveIdentifiedFoods' internal
          // concurrency) so cache insertion order is deterministic: index 0
          // is guaranteed oldest, index MAX_CACHE_ENTRIES guaranteed newest.
          for (let index = 0; index <= MAX_CACHE_ENTRIES; index += 1) {
            await resolveIdentifiedFoods([{ name: `bound-test-food-${index}` }], ENABLED);
          }
          assert.strictEqual(fetchCallCount, MAX_CACHE_ENTRIES + 1);

          // The oldest entry (index 0) should have been evicted to stay at the cap.
          await resolveIdentifiedFoods([{ name: 'bound-test-food-0' }], ENABLED);
          assert.strictEqual(fetchCallCount, MAX_CACHE_ENTRIES + 2, 'the oldest entry must have been evicted');

          // The newest entry should still be resident (cache hit — no new fetch).
          await resolveIdentifiedFoods([{ name: `bound-test-food-${MAX_CACHE_ENTRIES}` }], ENABLED);
          assert.strictEqual(
            fetchCallCount,
            MAX_CACHE_ENTRIES + 2,
            'the most recently added entry must still be cached',
          );
        } finally {
          restoreFetch();
        }
      });
    });

    // M123/06 review fix: cache hits must never hand back the same array or
    // FoodMatch/macrosPer100g object identity to two different callers.
    describe('cache hits return independent copies, never shared references (M123/06)', () => {
      it('a cache hit does not return the same array reference as the original resolve', async () => {
        stubFetch(async () => new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 }));
        try {
          const first = await resolveIdentifiedFoods([{ name: 'shared state food' }], ENABLED);
          const second = await resolveIdentifiedFoods([{ name: 'shared state food' }], ENABLED);
          assert.deepStrictEqual(first, second);
          assert.notStrictEqual(first[0], second[0], 'the inner match array must be a distinct reference per call');
          assert.notStrictEqual(
            first[0]?.[0],
            second[0]?.[0],
            'the FoodMatch object itself must be a distinct reference per call',
          );
        } finally {
          restoreFetch();
        }
      });

      it('mutating one caller\'s result does not corrupt what a later caller receives', async () => {
        stubFetch(async () => new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 }));
        try {
          const first = await resolveIdentifiedFoods([{ name: 'mutation isolation food' }], ENABLED);
          const firstMatch = first[0]?.[0];
          assert.ok(firstMatch);
          // Mutate the caller's own copy, including the nested macros object.
          firstMatch.slug = 'mutated-by-caller';
          firstMatch.macrosPer100g.kcal = -1;

          const second = await resolveIdentifiedFoods([{ name: 'mutation isolation food' }], ENABLED);
          assert.strictEqual(second[0]?.[0]?.slug, 'chicken-breast', 'a later caller must not see the mutation');
          assert.strictEqual(second[0]?.[0]?.macrosPer100g.kcal, 165, 'nested macros must not be shared either');
        } finally {
          restoreFetch();
        }
      });

      it('two concurrent identical lookups (in-flight dedupe) each get their own independent copy', async () => {
        stubFetch(async () => new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 }));
        try {
          const [first, second] = await Promise.all([
            resolveIdentifiedFoods([{ name: 'concurrent dedupe food' }], ENABLED),
            resolveIdentifiedFoods([{ name: 'concurrent dedupe food' }], ENABLED),
          ]);
          assert.deepStrictEqual(first, second);
          assert.notStrictEqual(first[0], second[0]);
        } finally {
          restoreFetch();
        }
      });
    });
  });

  // M123/07: `/api/food-matches` uses this to decide whether a request costs
  // anything upstream — and therefore whether it should count against the
  // caller's rate-limit budget. Side-effect-free is load-bearing: it must
  // never itself warm the cache or change LRU order.
  describe('allNamesCached (M123/07 — cache-aware rate-limit exemption)', () => {
    it('is true for an empty name list — nothing would reach the upstream lookup', () => {
      assert.strictEqual(allNamesCached([], ENABLED), true);
    });

    it('is true when the integration is disabled — resolution never reaches the upstream lookup either', () => {
      assert.strictEqual(allNamesCached(['chicken breast'], { enabled: false, apiUrl: '' }), true);
    });

    it('is false for a name that has never been resolved (a genuine cache miss)', () => {
      assert.strictEqual(allNamesCached(['never searched before'], ENABLED), false);
    });

    it('is true once a name has actually been resolved and cached', async () => {
      stubFetch(async () => new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 }));
      try {
        await resolveIdentifiedFoods([{ name: 'chicken breast' }], ENABLED);
        assert.strictEqual(allNamesCached(['chicken breast'], ENABLED), true);
        // Formatting differences collapse onto the same cache key.
        assert.strictEqual(allNamesCached(['  Chicken   Breast  '], ENABLED), true);
      } finally {
        restoreFetch();
      }
    });

    it('is false when even one of several names is uncached', async () => {
      stubFetch(async () => new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 }));
      try {
        await resolveIdentifiedFoods([{ name: 'rice' }], ENABLED);
        assert.strictEqual(allNamesCached(['rice', 'a genuinely novel food'], ENABLED), false);
      } finally {
        restoreFetch();
      }
    });

    it('does not itself warm the cache — checking is side-effect-free', async () => {
      let fetchCallCount = 0;
      stubFetch(async () => {
        fetchCallCount += 1;
        return new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 });
      });
      try {
        allNamesCached(['peek only food'], ENABLED);
        allNamesCached(['peek only food'], ENABLED);
        assert.strictEqual(fetchCallCount, 0, 'peeking must never trigger a network call');
      } finally {
        restoreFetch();
      }
    });

    it('is false again once a cached entry expires', async () => {
      const originalNow = Date.now;
      stubFetch(async () => new Response(JSON.stringify({ results: [buildRawResult()] }), { status: 200 }));
      try {
        await resolveIdentifiedFoods([{ name: 'expiring food' }], ENABLED);
        assert.strictEqual(allNamesCached(['expiring food'], ENABLED), true);
        // Past the module's SEARCH_CACHE_TTL_MS (5 minutes).
        Date.now = () => originalNow() + 6 * 60 * 1000;
        assert.strictEqual(allNamesCached(['expiring food'], ENABLED), false);
      } finally {
        Date.now = originalNow;
        restoreFetch();
      }
    });
  });
});
