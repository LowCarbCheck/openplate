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
 * The diary and the dashboard read nothing from a network today. So the
 * handshake is given `INSTANCE_BASIS_WAIT_MS` and no more: past that, the app
 * server's basis stands for this one load and is not kept as the tab's answer,
 * so the next load asks again. The handshake read itself is the tab's shared one
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

/** How long a load waits for the `/health` handshake before the app server's basis stands in. */
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

/** The handshake's answer, or `'timeout'` when it did not arrive in time. */
type InstanceRead = InstanceDescriptor | null | 'timeout';

/** The seams a test replaces: the handshake read and the wait. */
export interface NutrientReferenceBasisDeps {
  readInstance: (serverUrl: string) => Promise<InstanceDescriptor | null>;
  waitMs: number;
}

const DEFAULT_DEPS: NutrientReferenceBasisDeps = {
  readInstance: readCachedServerInstance,
  waitMs: INSTANCE_BASIS_WAIT_MS,
};

/**
 * The handshake, or `'timeout'` once `waitMs` has passed.
 *
 * @param input - the sync server and the seams.
 * @returns what the handshake said, or `'timeout'`.
 */
async function readInstanceWithin({
  serverUrl,
  deps,
}: {
  serverUrl: string;
  deps: NutrientReferenceBasisDeps;
}): Promise<InstanceRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deps.waitMs);
  });
  try {
    return await Promise.race([deps.readInstance(serverUrl), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The basis for a `clientLoader`, resolved as the vitamin and mineral rows
 * resolve theirs, and remembered for the tab once it settled.
 *
 * @param serverLoader - the route's own `serverLoader`, returning {@link NutrientReferenceBasisLoaderData}.
 * @param deps - test seams; the default reads the tab's shared handshake and waits {@link INSTANCE_BASIS_WAIT_MS}.
 * @returns the basis. Never rejects offline; any other loader fault is rethrown.
 */
export async function readNutrientReferenceBasis(
  serverLoader: () => Promise<NutrientReferenceBasisLoaderData>,
  deps: NutrientReferenceBasisDeps = DEFAULT_DEPS,
): Promise<NutrientReferenceBasis> {
  if (rememberedBasis !== null) return rememberedBasis;

  let config: NutrientReferenceBasisLoaderData;
  try {
    config = await serverLoader();
  } catch (cause) {
    if (!shouldFallbackOffline(cause)) throw cause;
    return DEFAULT_NUTRIENT_REFERENCE_BASIS;
  }

  if (config.syncServerUrl === null) {
    rememberedBasis = config.nutrientReferenceBasis;
    return rememberedBasis;
  }

  const instance = await readInstanceWithin({ serverUrl: config.syncServerUrl, deps });
  if (instance === 'timeout') {
    provisionalBasis = config.nutrientReferenceBasis;
    return provisionalBasis;
  }

  rememberedBasis = resolveNutrientReferenceBasis({
    instanceBasis: instance?.nutrientReferenceBasis ?? null,
    serverBasis: config.nutrientReferenceBasis,
  });
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
