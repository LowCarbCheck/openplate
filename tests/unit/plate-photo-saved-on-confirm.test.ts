/**
 * The confirmed plate's photograph is CACHED by the confirm action, on the
 * same signal that writes the diary rows.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * On 2026-09-08 a browser walk against a managed instance found that no plate
 * photograph had ever been cached. The save was armed by a `useNavigation()`
 * effect: it waited for a `submitting` render carrying `_intent=confirm`, then
 * fired on the `loading` render that followed. That pair of renders does not
 * happen. The confirm is a `clientAction` doing local IndexedDB work, and it
 * resolves inside one React batch, so the component never observes
 * `submitting` and the effect never reached its save.
 *
 * Every scan logged correctly, so nothing looked broken. Two promises were
 * quietly false: the AI settings copy says a copy is kept on the device "so
 * you can view it later", and a reported bad estimate went to the operator
 * with no picture at all (`hasImage: false` on every row).
 *
 * ── What is EXECUTED and what is READ ────────────────────────────────────
 *
 * The hand-off slot itself is executed, in `plate-photo-handoff.test.ts`.
 * The CHAIN from the review screen to `savePlatePhoto` is read out of
 * `app/routes/scan.tsx`: `handleConfirm` is internal to the route and driving
 * it needs the device store, the toast layer and i18n, which is the
 * integration tier's job rather than this one's (the same split
 * `food-logged-event.test.ts` makes, and for the same reason).
 *
 * The source assertions are about POSITION, not presence. The save must sit at
 * the action's own top level, after the rows are written and before the
 * redirect: that is what makes it unreachable from a validation failure, which
 * returns above it, and what stops it caching a photograph for rows that were
 * never written.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCAN_ROUTE = readFileSync(fileURLToPath(new URL('../../app/routes/scan.tsx', import.meta.url)), 'utf8');

/**
 * The body of a top-level function in the route source, from its header to the
 * next column-zero `}`. Throws rather than returning empty: a renamed handler
 * must fail the test that reads it, never silently pass on nothing.
 */
function topLevelFunctionBody(name: string): string {
  const header = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm').exec(SCAN_ROUTE);
  if (header === null) throw new Error(`function ${name} was not found in app/routes/scan.tsx`);
  const start = header.index;
  const end = SCAN_ROUTE.indexOf('\n}\n', start);
  if (end === -1) throw new Error(`function ${name} has no closing brace at column zero`);
  return SCAN_ROUTE.slice(start, end);
}

describe('the confirm action caches the plate photograph', () => {
  it('takes the hand-off at its own top level', () => {
    const body = topLevelFunctionBody('handleConfirm');

    assert.match(
      body,
      /^ {2}const offeredPhoto = takePlatePhoto\(logBatchId\);$/m,
      'handleConfirm no longer takes the photograph at its own top level. Nested in a branch, some confirms keep a picture and some do not.',
    );
  });

  it('saves it after the rows are written and before the redirect', () => {
    const body = topLevelFunctionBody('handleConfirm');
    const written = body.indexOf('putLocalFoodLog(');
    const saved = body.indexOf('savePlatePhoto(');
    const redirected = body.indexOf('return redirect(');

    assert.notEqual(written, -1, 'handleConfirm no longer writes an entry');
    assert.notEqual(saved, -1, 'handleConfirm no longer saves the photograph');
    assert.notEqual(redirected, -1, 'handleConfirm no longer redirects to the diary');
    assert.ok(written < saved, 'the photograph is cached BEFORE the rows exist, for a write that can still fail');
    assert.ok(saved < redirected, 'handleConfirm leaves the route before it saves the photograph');
  });

  it('keys the saved photograph to the batch id the form posted', () => {
    const body = topLevelFunctionBody('handleConfirm');

    // The same `logBatchId` every row in the batch carries, read off the form
    // and only minted here when the form carried none. That is the id the
    // diary and the report flow look the photograph up by.
    assert.match(body, /const logBatchId = submission\.value\.clientLogBatchId \?\? randomUuid\(\);/);
    assert.match(
      body,
      /savePlatePhoto\(\{ userId: offeredPhoto\.userId, logBatchId, file: offeredPhoto\.file \}\)/,
      'the photograph is saved under some other id than the rows it belongs to',
    );
  });

  it('cannot be reached by a confirm that fails validation', () => {
    const body = topLevelFunctionBody('handleConfirm');
    const schemaGuard = body.indexOf("if (submission.status !== 'success')");
    const emptyGuard = body.indexOf('if (includedItems.length === 0)');
    const taken = body.indexOf('takePlatePhoto(');

    assert.notEqual(schemaGuard, -1, 'handleConfirm no longer refuses an invalid submission');
    assert.notEqual(emptyGuard, -1, 'handleConfirm no longer refuses a plate with nothing included');
    assert.ok(schemaGuard < taken, 'an invalid submission now takes the photograph before it is refused');
    assert.ok(emptyGuard < taken, 'a plate with nothing included now takes the photograph before it is refused');
  });

  it('takes the photograph once, because a four-item plate is one capture', () => {
    const body = topLevelFunctionBody('handleConfirm');
    const takes = body.match(/takePlatePhoto\(/g) ?? [];

    assert.equal(takes.length, 1, 'the take moved into the per-item loop, where only the first item could find it');
  });
});

describe('the review screen offers the photograph instead of watching navigation', () => {
  it('offers the file under the batch id it posts as a hidden field', () => {
    const body = topLevelFunctionBody('ConfirmDraftForm');

    assert.match(body, /offerPlatePhoto\(\{ logBatchId: clientLogBatchId, userId, file: photoFile \}\)/);
    assert.match(
      body,
      /<input type="hidden" name="clientLogBatchId" value=\{clientLogBatchId\} \/>/,
      'the screen offers under a batch id it does not post, so the action can never take it',
    );
  });

  it('drops the offer when the screen or the draft goes away', () => {
    const body = topLevelFunctionBody('ConfirmDraftForm');

    assert.match(body, /return \(\) => dropPlatePhoto\(clientLogBatchId\);/);
  });

  it('no longer decides anything about the photograph from navigation state', () => {
    const body = topLevelFunctionBody('ConfirmDraftForm');

    assert.ok(
      !body.includes('savePlatePhoto('),
      'the screen saves the photograph again. A local action never renders a submitting state, so a save driven from this component fires on nothing.',
    );
    assert.ok(
      !body.includes('navigation.location'),
      'the screen reads the navigation location again, which is the signal that never arrived',
    );
  });
});
