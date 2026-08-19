/**
 * Backend selection: config in, a ready `FoodSource` (or nothing) out.
 *
 * THE FAILURE MODE THIS FILE OWNS. `FOOD_SOURCE=fdc` with a missing or corrupt
 * dataset must NOT stop the service from identifying plates. Identification is
 * the product; resolution is an enhancement on top of it. So a bad dataset
 * produces a LOUD warning and a disabled resolver, and every scan still returns a
 * valid response with `macrosPer100g: null` — which is exactly the same shape a
 * successful scan of an unrecognisable food produces, and exactly what the client
 * already handles.
 *
 * The alias table is a soft dependency of the FDC backend for the same reason: an
 * unreadable alias file is not worth failing German resolution over, let alone the
 * whole backend, so it is loaded with a warning and skipped on error.
 */
import { resolve } from 'node:path';
import type { ServiceConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { createEmbedder, type Embedder } from './embedding.js';
import { createFdcFoodSource } from './fdc.js';
import { createLccFoodSource } from './lcc.js';
import { createOffFoodSource } from './off.js';
import { SEARCH_FOODS, type FoodSource } from './types.js';

/**
 * Not an environment variable, deliberately: the table is authored in this repo,
 * versioned with the scorer that consumes it, and there is no operator decision
 * to make about where it lives.
 */
export const DE_ALIAS_PATH = './data/de-food-aliases.json';

export interface CreateFoodSourceOptions {
  config: ServiceConfig;
  logger: Logger;
  /** Test seam. Defaults to `DE_ALIAS_PATH`. */
  aliasPath?: string;
}

/** Returns `null` when resolution is off — by configuration or by a failed load. */
export function createFoodSourceFromConfig(options: CreateFoodSourceOptions): FoodSource | null {
  const { config, logger } = options;

  if (config.foodSource === 'none') {
    logger.info('Nutrition resolution disabled (FOOD_SOURCE=none)', { stage: SEARCH_FOODS });
    return null;
  }

  if (config.foodSource === 'off') {
    logger.warn('Nutrition resolution using OpenFoodFacts — ODbL data fetched at YOUR runtime', {
      stage: SEARCH_FOODS,
      license: 'ODbL 1.0',
    });
    return createOffFoodSource();
  }

  if (config.foodSource === 'lcc') {
    logger.info('Nutrition resolution using the lowcarbcheck API (remote, opt-in)', {
      stage: SEARCH_FOODS,
      apiUrl: config.lccApiUrl,
    });
    return createLccFoodSource({ apiUrl: config.lccApiUrl });
  }

  const datasetPath = resolve(config.fdcDatasetPath);
  try {
    const source = createFdcFoodSource({
      datasetPath,
      aliasPath: resolve(options.aliasPath ?? DE_ALIAS_PATH),
    });
    logger.info('Nutrition resolution using the bundled USDA FDC dataset', {
      stage: SEARCH_FOODS,
      datasetPath,
      license: source.describe().license,
    });
    return source;
  } catch (error) {
    // Second chance WITHOUT the alias table: a broken alias file should cost
    // German recall, not the entire default backend.
    try {
      const source = createFdcFoodSource({ datasetPath });
      logger.warn('German alias table unusable — resolving English names only', {
        stage: SEARCH_FOODS,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      return source;
    } catch (datasetError) {
      logger.error(
        'FOOD_SOURCE=fdc but the dataset could not be loaded — nutrition resolution is DISABLED. ' +
          'Scans still work; every item will report macrosPer100g: null. ' +
          'Generate the dataset with `pnpm food-data:fdc` or set FOOD_SOURCE=none to silence this.',
        {
          stage: SEARCH_FOODS,
          datasetPath,
          reason: datasetError instanceof Error ? datasetError.message : 'unknown error',
        },
      );
      return null;
    }
  }
}

/** Returns `null` when `EMBEDDING_RUNTIME_URL` is unset — retrieval is then lexical-only. */
export function createEmbedderFromConfig(options: {
  config: ServiceConfig;
  logger: Logger;
}): Embedder | null {
  if (!options.config.embeddingRuntimeUrl) {
    // Conflicting intent: a key was supplied for a runtime that will never be
    // contacted. A WARN rather than a throw — nothing is broken and no work is
    // wasted, unlike the entrypoint's bundled-profile-plus-external-URL case —
    // but silently ignoring a variable an operator deliberately set is exactly
    // the invisible degradation this feature exists to remove.
    if (options.config.embeddingRuntimeApiKey) {
      options.logger.warn(
        'EMBEDDING_RUNTIME_API_KEY is set but EMBEDDING_RUNTIME_URL is not — the key is ignored and retrieval stays lexical-only',
        { stage: SEARCH_FOODS },
      );
    }
    return null;
  }
  options.logger.info('Hybrid retrieval enabled (lexical + embedding)', {
    stage: SEARCH_FOODS,
    embeddingRuntimeUrl: options.config.embeddingRuntimeUrl,
  });
  return createEmbedder({
    baseUrl: options.config.embeddingRuntimeUrl,
    apiKey: options.config.embeddingRuntimeApiKey,
    logger: options.logger,
  });
}

export { createFdcFoodSource, FdcDatasetError } from './fdc.js';
export { createLccFoodSource } from './lcc.js';
export { createOffFoodSource } from './off.js';
export * from './types.js';
