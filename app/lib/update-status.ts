/**
 * The `/api/update-status` wire contract, written down once.
 *
 * The server builds this object (`update-check.server.ts`, mounted in
 * `server.ts`) and the browser parses it (`update-store.ts`). Both ends import
 * this file, so the two cannot drift the way the sync protocol can (that one is
 * duplicated across repositories on purpose; this one is not).
 *
 * ── WHAT IS AND IS NOT IN HERE ──────────────────────────────────────────────
 *
 * Everything here is about the SOFTWARE: which version this instance runs, which
 * version the project has published, when the server last looked. Nothing about
 * the person asking, and nothing the browser sent. The endpoint is unauthenticated
 * and identical for every caller, which is what lets it stay a plain GET with no
 * caching subtleties.
 */
import { z } from 'zod';

export const updateStatusSchema = z.object({
  /**
   * False when the operator set `UPDATE_CHECK=off`. The UI says "checks
   * disabled" and offers no button, and no request has left the server.
   */
  enabled: z.boolean(),
  /** The version this server is running. */
  currentVersion: z.string(),
  /** The commit this server is running, or `unknown`. */
  sha: z.string(),
  /** When this server's bundle was built (ISO 8601). */
  builtAt: z.string(),
  /** The highest published version the server has seen, or null if it never got an answer. */
  latest: z.string().nullable(),
  /** Where to read about that version. Null whenever `latest` is. */
  releaseUrl: z.string().nullable(),
  /** When the last successful look at GitHub finished (ISO 8601), or null. */
  checkedAt: z.string().nullable(),
  /** Whether `latest` is newer than `currentVersion`. */
  updateAvailable: z.boolean(),
  /**
   * Set only on `POST /api/update-status/check`, when the manual check was
   * refused because one already ran inside the cooldown. The body is still the
   * cached answer, so a client can render it either way.
   */
  throttled: z.boolean(),
  /** When the next manual check will be accepted (ISO 8601). Null when one is allowed now. */
  nextCheckAllowedAt: z.string().nullable(),
});

export type UpdateStatus = z.infer<typeof updateStatusSchema>;

/** The response header every response from `server.ts` carries: the server's commit. */
export const BUILD_HEADER = 'X-Openplate-Build';
