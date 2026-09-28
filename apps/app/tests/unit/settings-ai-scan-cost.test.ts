/**
 * Unit tests for `#app/routes/settings.ai`'s `describeApproxScanCost` — the
 * plain-money replacement for the old "$0.25 in / $1.50 out per 1M tokens"
 * line on the model picker. Importing the route module directly is an
 * established pattern in this suite (see `diary-route.test.ts`,
 * `add-route.test.ts`): module-level code in a route file is just
 * function/constant declarations, so nothing browser- or server-dependent
 * runs at import time.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { describeApproxScanCost, type Translate } from '../../app/routes/settings.ai';

/**
 * Stub translator mirroring the two English catalog entries this helper picks
 * between (M129/05 string extraction). Kept here rather than reaching for the
 * real i18next instance so these tests stay about the ROUNDING DECISION, which
 * is what the helper actually owns now that the copy lives in the catalogs.
 */
const t: Translate = (key, params = {}) => {
  if (key === 'settingsAi.cost.underCent') return 'under a cent a photo';
  if (key === 'settingsAi.cost.approxCents') return `about ${String(params.cents)}¢ a photo`;
  throw new Error(`unexpected translation key: ${key}`);
};

describe('describeApproxScanCost', () => {
  it('says "under a cent" for a cheap model, never a $/1M-token price', () => {
    const line = describeApproxScanCost({ model: { inPerM: 0.25, outPerM: 1.5 }, t });
    assert.equal(line, 'under a cent a photo');
    assert.ok(!line.includes('$'));
    assert.ok(!line.includes('1M'));
  });

  it('rounds up to a whole cent for a pricier model', () => {
    // 1500 * 5 / 1e6 + 300 * 30 / 1e6 = 0.0165 -> ceil(1.65) = 2
    assert.equal(describeApproxScanCost({ model: { inPerM: 5.0, outPerM: 30.0 }, t }), 'about 2¢ a photo');
  });

  it('never undersells: a cost at exactly the cent threshold reads "about 1¢", not "under a cent"', () => {
    // outPerM chosen so 300 * outPerM / 1e6 lands on exactly $0.01.
    const line = describeApproxScanCost({ model: { inPerM: 0, outPerM: 10000 / 300 }, t });
    assert.equal(line, 'about 1¢ a photo');
  });
});
