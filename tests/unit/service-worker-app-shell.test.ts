/**
 * `public/sw.js` is a plain JS file served statically — it is never bundled or
 * type-checked, so nothing else in this repo notices if `APP_SHELL` loses an
 * entry. This test reads the source directly and pins the two paths the
 * `_personal` gate can redirect an offline device to (M123/11): `/recover`,
 * which a wiped-but-previously-used device is sent to, and `/onboarding`,
 * which a not-yet-onboarded device is sent to. Neither has any other way of
 * getting cached before the redirect fires, so dropping either from the array
 * silently strands that device on `/offline` again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const SW_PATH = fileURLToPath(new URL('../../public/sw.js', import.meta.url));

const appShellSchema = z.array(z.string());

/**
 * Parses `APP_SHELL` out of the service worker source without relying on a
 * regex over the surrounding comments or formatting — only the array literal
 * assigned to `const APP_SHELL` is evaluated, so a reformat of the file
 * (reflowed comments, different quote style) cannot break this test. The
 * parsed JSON is validated at this boundary with a schema rather than trusted
 * as-is, since it came from parsing a source file, not a typed API.
 */
function readAppShell(): string[] {
  const source = readFileSync(SW_PATH, 'utf-8');
  const match = source.match(/const APP_SHELL = (\[[^\]]*\]);/);
  assert.ok(match, 'expected to find a `const APP_SHELL = [...]` declaration in public/sw.js');
  return appShellSchema.parse(JSON.parse(match[1].replace(/'/g, '"')));
}

test('APP_SHELL precaches /recover, so a wiped device can reach it offline', () => {
  assert.ok(readAppShell().includes('/recover'));
});

test('APP_SHELL precaches /onboarding, so a not-yet-onboarded device can reach it offline', () => {
  assert.ok(readAppShell().includes('/onboarding'));
});

test('APP_SHELL still precaches the core navigation targets', () => {
  const shell = readAppShell();
  for (const path of ['/', '/dashboard', '/diary', '/add/search', '/offline']) {
    assert.ok(shell.includes(path), `expected APP_SHELL to include ${path}`);
  }
});

// ADR-0019, the one redirect the ADR says must keep forwarding its query
// string indefinitely: an installed app's OLD service worker keeps sending a
// shared photo to whatever this exact source said at the time it was
// installed, until the device updates. Source-text, not a live ServiceWorker
// + caches mock, per the ADR's own "don't over-build this" note.
test('handleShareTarget redirects a received photo to /add/photo?shared=1', () => {
  const source = readFileSync(SW_PATH, 'utf-8');
  assert.match(
    source,
    /Response\.redirect\(new URL\('\/add\/photo\?shared=1', self\.location\.origin\)\.toString\(\), 303\)/,
    'expected the successful-receive branch to redirect to /add/photo?shared=1',
  );
});

test('handleShareTarget falls back to a bare /add/photo when nothing was received', () => {
  const source = readFileSync(SW_PATH, 'utf-8');
  assert.match(
    source,
    /Response\.redirect\(new URL\('\/add\/photo', self\.location\.origin\)\.toString\(\), 303\)/,
    'expected the fallback branch to redirect to /add/photo',
  );
});
