/**
 * Environment variable access helpers.
 *
 * Single place for reading `process.env` with clear failure messages and
 * typed defaults. Used by `#app/config` (the single source of truth for
 * environment-derived configuration) and safe to reuse anywhere else a
 * typed env read is needed.
 */

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

/** Reads an optional string environment variable, falling back to `defaultValue`. */
export function optionalEnv(name: string, defaultValue: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return value;
}

/** Reads an optional boolean environment variable ('true'/'false', case-insensitive). */
export function optionalBoolEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return defaultValue;
  return value.trim().toLowerCase() === 'true';
}

/** Reads an optional integer environment variable, falling back to `defaultValue` if unset or unparseable. */
export function optionalIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}
