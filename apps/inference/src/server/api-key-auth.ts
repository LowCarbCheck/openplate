/**
 * Bearer API-key authentication for `/v1/*`.
 *
 * NO COOKIES, ANYWHERE — the key travels in `Authorization: Bearer <key>` so any
 * openplate client, on any origin, can talk to any instance of this service.
 *
 * Comparison is constant-time over a fixed-length digest. Comparing the raw
 * strings with `===` leaks a prefix-match oracle through timing, and comparing
 * raw buffers leaks the key LENGTH through the length check that
 * `timingSafeEqual` requires. Hashing first makes every candidate the same size.
 *
 * The resolved key identity hangs off a `WeakMap` keyed by the request rather
 * than a mutated `req.apiKey`. Declaration-merging Express's `Request` would make
 * the field appear on every request in the type system, including the
 * unauthenticated ones this middleware exists to stop.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { unauthorized } from '../errors.js';

/** Length of the logged key fingerprint. Enough to tell tenants apart, useless for guessing. */
const KEY_ID_LENGTH = 8;

export interface ApiKeyIdentity {
  /** Short, non-reversible fingerprint. This — never the key — is what gets logged. */
  keyId: string;
}

const identityByRequest = new WeakMap<Request, ApiKeyIdentity>();

function digest(key: string): Buffer {
  return createHash('sha256').update(key, 'utf8').digest();
}

/** A stable, non-reversible id for a key: the first 8 hex chars of its SHA-256. */
export function apiKeyId(key: string): string {
  return digest(key).toString('hex').slice(0, KEY_ID_LENGTH);
}

export function getApiKeyIdentity(req: Request): ApiKeyIdentity | null {
  return identityByRequest.get(req) ?? null;
}

export function parseBearerHeader(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() || null : null;
}

/**
 * Rejects with `401` unless the request carries a configured key. Absent,
 * malformed and unknown keys are all the same message — telling them apart tells
 * an attacker which guesses were close.
 */
export function createApiKeyAuth(apiKeys: readonly string[]): RequestHandler {
  const digests = apiKeys.map((key) => digest(key));

  return function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
    const presented = parseBearerHeader(req.header('authorization'));
    if (presented === null) {
      next(unauthorized('Missing API key. Send `Authorization: Bearer <your key>`.'));
      return;
    }
    const presentedDigest = digest(presented);
    const matched = digests.some((known) => timingSafeEqual(known, presentedDigest));
    if (!matched) {
      next(unauthorized('Incorrect API key provided.'));
      return;
    }
    identityByRequest.set(req, { keyId: apiKeyId(presented) });
    next();
  };
}
