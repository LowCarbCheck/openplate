/**
 * The one running fake sync service, held for the lifetime of a Playwright run.
 *
 * `globalSetup` starts it and `globalTeardown` closes it, and those are two
 * modules in ONE process, so a module-scoped variable is the whole mechanism.
 * It is a module of its own rather than an export of the setup file because
 * importing `global-setup.ts` from the teardown would re-run nothing (module
 * caching) on a good day and re-run the account creation on a bad one.
 */
import type { FakeSyncService } from '../integration/fake-sync-service';

let running: FakeSyncService | null = null;

/** Records the service the setup started. */
export function holdFakeService(service: FakeSyncService): void {
  running = service;
}

/** The running service, or `null` when nothing was started. */
export function heldFakeService(): FakeSyncService | null {
  return running;
}

/** Closes and forgets the running service. Safe to call when there is none. */
export async function releaseFakeService(): Promise<void> {
  if (running === null) return;
  const service = running;
  running = null;
  await service.close();
}
