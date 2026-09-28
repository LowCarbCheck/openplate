/**
 * Closes the fake services `global-setup.ts` started.
 *
 * A listening socket keeps the runner's process alive, so this is not tidiness:
 * without it a green run hangs after the last spec.
 */
import { releaseFakeFoodDb, releaseFakeService } from './fake-service-handle';

export default async function globalTeardown(): Promise<void> {
  await releaseFakeService();
  await releaseFakeFoodDb();
}
