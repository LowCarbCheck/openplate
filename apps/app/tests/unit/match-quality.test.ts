/**
 * Unit tests for `#app/lib/match-quality` — the pure score→trust-tier mapping
 * that decides how confidently a curated match is presented. No React/DB/network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isConfidentTier,
  matchTier,
  matchTierChipClass,
  matchTierLabel,
  type MatchTier,
} from '../../app/lib/match-quality';

describe('matchTier', () => {
  // Thresholds are calibrated against LCC's real lexical-tier score bands
  // (see `#app/lib/match-quality`'s doc comments) — 0.85 sits in the gap
  // between the prefix tier's floor (0.875) and the token-prefix tier's
  // ceiling (0.825); 0.58 sits in the gap between the substring tier's floor
  // (0.6) and the token-overlap tier's ceiling (0.55).
  it('classifies scores at or above 0.85 as strong', () => {
    assert.strictEqual(matchTier(1), 'strong');
    assert.strictEqual(matchTier(0.85), 'strong');
  });

  it('classifies scores in [0.58, 0.85) as likely', () => {
    assert.strictEqual(matchTier(0.84), 'likely');
    assert.strictEqual(matchTier(0.58), 'likely');
  });

  it('classifies scores below 0.58 as weak', () => {
    assert.strictEqual(matchTier(0.57), 'weak');
    assert.strictEqual(matchTier(0), 'weak');
  });

  it('discriminates within LCC\'s real prefix-tier score cluster (0.88-0.95) rather than calling all of it "strong" alongside weaker tiers', () => {
    // Regression guard for the "everything reads as strong" defect: a
    // genuine token-prefix-tier hit (e.g. 0.8) must NOT land in the same
    // tier as a genuine prefix-tier hit (e.g. 0.9) — see the live "egg"/
    // "cheese"/"bread" sample in add.tsx's readability-reorder doc comment.
    assert.strictEqual(matchTier(0.9), 'strong');
    assert.strictEqual(matchTier(0.8), 'likely');
  });
});

describe('isConfidentTier', () => {
  it('treats strong and likely as confident, weak as not', () => {
    assert.strictEqual(isConfidentTier('strong'), true);
    assert.strictEqual(isConfidentTier('likely'), true);
    assert.strictEqual(isConfidentTier('weak'), false);
  });
});

describe('tier presentation maps', () => {
  const tiers: MatchTier[] = ['strong', 'likely', 'weak'];

  it('has a human label for every tier', () => {
    assert.strictEqual(matchTierLabel.strong, 'Strong match');
    assert.strictEqual(matchTierLabel.likely, 'Possible match');
    for (const tier of tiers) {
      assert.ok(matchTierLabel[tier].length > 0);
    }
  });

  it('has a subtle zinc chip class for every tier', () => {
    for (const tier of tiers) {
      assert.match(matchTierChipClass[tier], /zinc/);
    }
  });
});
