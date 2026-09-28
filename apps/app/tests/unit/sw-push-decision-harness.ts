/**
 * Load `public/sw-push-decision.js`, the service worker's copy of the push
 * decision, into a node test.
 *
 * The file is a classic script: it cannot be imported, because it ends in
 * `})(self)` and a node module has no `self`. So it is evaluated in a `vm`
 * context whose only global of interest is a bare `self` object, which is the
 * narrowest possible stand-in for the worker scope and proves at the same time
 * that the file touches nothing else on it.
 *
 * The source is taken as an argument rather than read inside, so the parity
 * test can hand in a MUTATED copy and check that the comparison it relies on
 * can actually fail.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import type { NotificationData, PushDecision, StoredCatchUpRecord } from '../../app/lib/push-decision';

/** The two functions the worker calls, typed off the source module. */
export interface PushDecisionModule {
  decidePush(
    kind: string,
    record: StoredCatchUpRecord | null,
    nowMs: number,
    navigatorLanguage: string,
  ): PushDecision;
  notificationPath(data: NotificationData | null): string;
}

export const WORKER_COPY_PATH = fileURLToPath(new URL('../../public/sw-push-decision.js', import.meta.url));

/** The worker's copy, as text. */
export function readWorkerCopySource(): string {
  return readFileSync(WORKER_COPY_PATH, 'utf8');
}

/** The one global the worker copy is allowed to touch. */
interface WorkerScope {
  openplatePushDecision?: PushDecisionModule;
}

/** The vm context the copy is evaluated in: a scope object and nothing else. */
interface WorkerSandbox {
  self: WorkerScope;
}

/** Evaluate a copy of the worker module and hand back what it attached. */
export function loadWorkerPushDecision(source: string): PushDecisionModule {
  const scope: WorkerSandbox = { self: {} };
  runInNewContext(source, scope, { filename: WORKER_COPY_PATH });

  const attached = scope.self.openplatePushDecision;
  if (!attached) {
    throw new Error(`${WORKER_COPY_PATH} did not attach self.openplatePushDecision`);
  }
  return attached;
}
