/**
 * Zod compiles nothing at run time in this app (M253/11 item 3).
 *
 * Zod 4 builds a faster object parser with `new Function` when it may, and it
 * finds out by calling `new Function("")` once and catching the refusal. The
 * production content security policy refuses `eval` on purpose, so in the
 * browser the probe never succeeded, and the browser reported it as a policy
 * violation on every page load. That noise would hide a real violation.
 *
 * `jitless` skips the probe and the compiled parser both. It must be set
 * BEFORE the first object schema is built, because zod decides at build time,
 * and schemas are built at module load. So this module is the FIRST import of
 * `root.tsx` (the first route module a document evaluates, before the client
 * entry) and of `entry.server.tsx`. Importing it for its effect is the whole
 * API.
 */
import { z } from 'zod';

z.config({ jitless: true });
