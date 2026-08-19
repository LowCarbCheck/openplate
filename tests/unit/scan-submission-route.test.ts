/**
 * Unit tests for `decideScanSubmissionRoute` — the pure dispatch decision
 * extracted from `scan.tsx`'s `clientAction` (M117/02 review fix).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decideScanSubmissionRoute } from '../../app/lib/scan-submission-route';

describe('decideScanSubmissionRoute', () => {
  it('routes a confirm submission to the server (food-log writes stay server-side)', () => {
    assert.equal(decideScanSubmissionRoute('confirm'), 'server');
  });

  it('routes an identify submission to the client (the BYOK vision call)', () => {
    assert.equal(decideScanSubmissionRoute('identify'), 'client');
  });

  it('routes a null intent (no _intent field submitted) to the client', () => {
    assert.equal(decideScanSubmissionRoute(null), 'client');
  });

  it('routes an unrecognized intent to the client — fails toward never touching the server', () => {
    assert.equal(decideScanSubmissionRoute('something-else'), 'client');
  });
});
