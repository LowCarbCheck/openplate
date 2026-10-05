/**
 * The one place `pnpm ai-tiers:check-live` touches the network. It sends a plain
 * GET with no credential, because the two endpoints it reads are public. Tests
 * never import this file: they hand `runCli` a function that plays recorded answers.
 */
import type { JsonValue } from '../../src/lib/json.js';
import type { FetchedJson } from './check.js';

const REQUEST_TIMEOUT_MS = 30_000;

function parseBody(text: string): JsonValue | null {
  try {
    // SAFETY: `JSON.parse` returns JSON by construction; the decoders in
    // `check.ts` re-establish every key and type before anything is used.
    return JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
}

/** Throws when the request cannot be made (no route, timeout). Any HTTP status comes back as an answer. */
export async function fetchJsonFromNetwork(url: string): Promise<FetchedJson> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: response.status, body: parseBody(await response.text()) };
}
