/**
 * An invite token must never be built into a query string — in this repo or in
 * the operator CLI that generates the links people click.
 *
 * WHY A SOURCE WALK RATHER THAN A BEHAVIOUR TEST. The failure this guards
 * against is not a wrong result; it is a correct-looking link that leaks. A
 * `?invite=` link works perfectly: the person joins, the account is created,
 * every functional test passes. What it also does is write a live capability
 * into the browser's history, into the `Referer` of the next request, and into
 * the access log of every server between the sender and the recipient. Nothing
 * observable from inside the app can catch that, so the rule is enforced where
 * it can be — on the text that builds the link.
 *
 * The fragment form is asserted as present too, so this file cannot pass
 * vacuously in a tree where the feature was deleted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SCOPED TO THE PATHS THAT REDEEM AN INVITE, deliberately.
 *
 * `app/lib/join-link.ts` and `app/routes/join.tsx` joined the sync sources in
 * M181/05: the join link carries the gateway's token in the same fragment, so
 * the rule now covers both services' capabilities.
 *
 * Two files still read a `?invite=` and are deliberately NOT walked.
 * `app/lib/gateway-invite.ts` normalizes a token whatever its source, and
 * `app/routes/connect-gateway.tsx` exists ONLY to translate the old query-string
 * link into a fragment and redirect — reading that query is the entire job, and
 * a check that fails on the code fixing the problem gets suppressed rather than
 * obeyed.
 */
const SYNC_SOURCES: readonly string[] = [
  join(process.cwd(), 'app', 'lib', 'sync'),
  join(process.cwd(), 'app', 'lib', 'join-link.ts'),
  join(process.cwd(), 'app', 'routes', 'settings.sync.tsx'),
  join(process.cwd(), 'app', 'routes', 'join.tsx'),
];

function sourceFiles(target: string): string[] {
  if (!statSync(target).isDirectory()) return [target];

  const found: string[] = [];
  for (const entry of readdirSync(target)) {
    const path = join(target, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(path);
  }
  return found;
}

function syncSourceFiles(): string[] {
  return SYNC_SOURCES.flatMap((target) => sourceFiles(target));
}

test('no source file builds an invite as a query parameter', () => {
  const offenders = syncSourceFiles().filter((path) => {
    const source = readFileSync(path, 'utf8');
    // Both spellings a link builder would plausibly produce.
    return source.includes('?invite=') || source.includes("searchParams.get('invite')");
  });

  assert.deepEqual(offenders, [], `an invite token must travel in the URL fragment, never the query string`);
});

test('the fragment form IS present, so the check above is not vacuous', () => {
  const withFragment = syncSourceFiles().filter((path) => readFileSync(path, 'utf8').includes("#invite="));
  assert.ok(withFragment.length > 0, 'no source file reads an invite at all — has the feature been removed?');
});
