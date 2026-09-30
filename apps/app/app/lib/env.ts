/**
 * Environment variable access helpers.
 *
 * Typed reads with clear failure messages and typed defaults. Used by
 * `#app/config` (the single source of truth for environment-derived
 * configuration), which hands every read its env bag so the whole config can
 * be parsed from any environment, not only `process.env`.
 */

/** One variable read out of an env bag, with the value an unset or empty one falls back to. */
export interface EnvRead<T> {
  env: NodeJS.ProcessEnv;
  name: string;
  fallback: T;
}

/**
 * Reads a required environment variable. Throws with a clear message if the
 * variable is unset or empty — fail fast rather than continuing with an
 * undefined value.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Reads an optional string environment variable. Unset and empty both mean `fallback`. */
export function optionalEnv(read: EnvRead<string>): string {
  const value = read.env[read.name];
  if (value === undefined || value === '') return read.fallback;
  return value;
}

/** Reads an optional integer environment variable, falling back to `fallback` if unset, empty or unparseable. */
export function optionalIntEnv(read: EnvRead<number>): number {
  const value = read.env[read.name];
  if (value === undefined || value.trim() === '') return read.fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? read.fallback : parsed;
}
