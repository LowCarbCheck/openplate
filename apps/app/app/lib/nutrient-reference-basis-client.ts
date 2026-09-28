/**
 * WHOSE REFERENCE VALUES THE PROTEIN REFERENCE FOLLOWS, read on the device
 * (M263/04).
 *
 * The protein row's population reference is computed in the browser, in a
 * `clientLoader` or a `clientAction`, from the on-device body data. Under the
 * `dge` basis it is DGE's table, under `efsa` and `us` it is EFSA's 0.83 g/kg
 * (`computeReferenceProteinFloor`). So the browser has to name a basis, where
 * the `/nutrients` screen can leave the naming to the server.
 *
 * ── The same resolution as the vitamin and mineral rows ─────────────────
 *
 * `/nutrients` asks `/api/nutrients` with the basis the sync server's `/health`
 * handshake publishes (`InstanceDescriptor.nutrientReferenceBasis`), and with no
 * basis at all when there is none, which makes this app's server answer with
 * its own `NUTRIENT_REFERENCE_BASIS` (`CONFIG.nutrients.referenceBasis`, `dge`
 * when unset). This module gives the same answer in one step: the handshake's
 * basis when there is one, else the app server's own. The app server's value
 * reaches the browser through the calling route's server loader, the way
 * `readInstancePolicy` reads `managed`.
 *
 * ── A local-first screen does not wait on the network for it ───────────
 *
 * The diary and the dashboard read nothing else from a network. So the WHOLE
 * resolution, the server loader's `.data` fetch and the handshake after it, gets
 * one budget, `INSTANCE_BASIS_WAIT_MS`, and no more. Past it, this load uses the
 * app server's basis when the server loader answered in time, else
 * `DEFAULT_NUTRIENT_REFERENCE_BASIS`. Neither is kept as the tab's answer, so the
 * next load asks again. The handshake read itself is the tab's shared one
 * (`readCachedServerInstance`), so waiting here never sends a second request.
 *
 * ── Once per tab ─────────────────────────────────────────────────────────
 *
 * A settled answer is remembered for the tab, the lifetime the handshake itself
 * has (an administrator's change shows after a reload, and the admin form says
 * so). After that no route here fetches its server loader again for it. A
 * `clientAction` has no server loader to call, so it reads the remembered
 * answer; the route's own `clientLoader` ran first and put it there.
 *
 * ── Offline, with nothing remembered ─────────────────────────────────────
 *
 * The server loader's `.data` fetch rejects, and there is no basis to read at
 * all. Then `DEFAULT_NUTRIENT_REFERENCE_BASIS` applies, the basis an instance
 * serves when its operator chose none. It is not remembered either.
 */
import { readCachedServerInstance } from '#app/hooks/use-server-instance';
import { shouldFallbackOffline } from '#app/lib/local-store';
import { DEFAULT_NUTRIENT_REFERENCE_BASIS, type NutrientReferenceBasis } from '#app/lib/nutrient-reference';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';

/**
 * What a route's server loader returns for this to work: the sync server to
 * ask, and the app server's own configured basis.
 */
export interface NutrientReferenceBasisLoaderData {
  syncServerUrl: string | null;
  nutrientReferenceBasis: NutrientReferenceBasis;
}

/** How long one load waits for the server loader and the `/health` handshake together. */
export const INSTANCE_BASIS_WAIT_MS = 1500;

/** The settled answer for this tab, or `null` until one settled. */
let rememberedBasis: NutrientReferenceBasis | null = null;

/**
 * The app server's basis from a load whose handshake did not answer in time,
 * so a `clientAction` on that page computes with the number the page showed.
 */
let provisionalBasis: NutrientReferenceBasis | null = null;

/**
 * The basis the instance shows: the sync server's, else the app server's.
 *
 * @param input - the handshake's basis (`null` when none was published or read) and the app server's.
 * @returns the basis to compute with.
 */
export function resolveNutrientReferenceBasis({
  instanceBasis,
  serverBasis,
}: {
  instanceBasis: NutrientReferenceBasis | null;
  serverBasis: NutrientReferenceBasis;
}): NutrientReferenceBasis {
  return instanceBasis ?? serverBasis;
}

/** The seams a test replaces: the handshake read and the budget. */
export interface NutrientReferenceBasisDeps {
  readInstance: (serverUrl: string) => Promise<InstanceDescriptor | null>;
  waitMs: number;
}

const DEFAULT_DEPS: NutrientReferenceBasisDeps = {
  readInstance: readCachedServerInstance,
  waitMs: INSTANCE_BASIS_WAIT_MS,
};

/** How one resolution ended: a basis to keep for the tab, or offline with nothing to read. */
type Resolution = { kind: 'settled'; basis: NutrientReferenceBasis } | { kind: 'offline' };

/** What a resolution learned on the way, so a timeout can still use the server loader's answer. */
interface ResolutionProgress {
  serverBasis: NutrientReferenceBasis | null;
}

/**
 * The server loader, then the handshake, with no time limit of its own. The
 * caller races it against the budget.
 *
 * @param input - the route's server loader, the seams, and where to note the server's basis.
 * @returns the settled basis, or offline. Any loader fault that is not the network rejects.
 */
async function resolveBasis({
  serverLoader,
  deps,
  progress,
}: {
  serverLoader: () => Promise<NutrientReferenceBasisLoaderData>;
  deps: NutrientReferenceBasisDeps;
  progress: ResolutionProgress;
}): Promise<Resolution> {
  let config: NutrientReferenceBasisLoaderData;
  try {
    config = await serverLoader();
  } catch (cause) {
    if (!shouldFallbackOffline(cause)) throw cause;
    return { kind: 'offline' };
  }
  progress.serverBasis = config.nutrientReferenceBasis;
  if (config.syncServerUrl === null) return { kind: 'settled', basis: config.nutrientReferenceBasis };

  const instance = await deps.readInstance(config.syncServerUrl);
  return {
    kind: 'settled',
    basis: resolveNutrientReferenceBasis({
      instanceBasis: instance?.nutrientReferenceBasis ?? null,
      serverBasis: config.nutrientReferenceBasis,
    }),
  };
}

/**
 * `work`, or `'timeout'` once `waitMs` has passed.
 *
 * @param input - the promise to wait for and the budget.
 * @returns what `work` settled with, or `'timeout'`. A rejection of `work` inside the budget rejects.
 */
async function settleWithin<T>({ work, waitMs }: { work: Promise<T>; waitMs: number }): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), waitMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The basis for a `clientLoader`, resolved as the vitamin and mineral rows
 * resolve theirs, within one budget, and remembered for the tab once it settled.
 *
 * @param serverLoader - the route's own `serverLoader`, returning {@link NutrientReferenceBasisLoaderData}.
 * @param deps - test seams; the default reads the tab's shared handshake within {@link INSTANCE_BASIS_WAIT_MS}.
 * @returns the basis. Never rejects offline or on a timeout; any other loader fault is rethrown.
 */
export async function readNutrientReferenceBasis(
  serverLoader: () => Promise<NutrientReferenceBasisLoaderData>,
  deps: NutrientReferenceBasisDeps = DEFAULT_DEPS,
): Promise<NutrientReferenceBasis> {
  if (rememberedBasis !== null) return rememberedBasis;

  const progress: ResolutionProgress = { serverBasis: null };
  const work = resolveBasis({ serverLoader, deps, progress });
  // A loader fault that arrives AFTER the budget ran out has nobody left to
  // hear it. Marking the promise handled keeps it from surfacing as an
  // unhandled rejection; inside the budget the race below still rethrows it.
  work.catch(() => undefined);

  const outcome = await settleWithin({ work, waitMs: deps.waitMs });
  if (outcome === 'timeout') {
    provisionalBasis = progress.serverBasis ?? DEFAULT_NUTRIENT_REFERENCE_BASIS;
    return provisionalBasis;
  }
  if (outcome.kind === 'offline') return DEFAULT_NUTRIENT_REFERENCE_BASIS;
  rememberedBasis = outcome.basis;
  return rememberedBasis;
}

/**
 * The basis for a `clientAction`: the one this tab's `clientLoader` settled,
 * else the app server's from a load that timed out, else
 * `DEFAULT_NUTRIENT_REFERENCE_BASIS` (see the module note on offline).
 *
 * @returns the basis.
 */
export function readRememberedNutrientReferenceBasis(): NutrientReferenceBasis {
  return rememberedBasis ?? provisionalBasis ?? DEFAULT_NUTRIENT_REFERENCE_BASIS;
}

/** Test-only: forgets the tab's answers so cases do not leak into each other. */
export function forgetNutrientReferenceBasis(): void {
  rememberedBasis = null;
  provisionalBasis = null;
}
