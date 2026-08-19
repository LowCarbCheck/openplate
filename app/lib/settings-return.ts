/**
 * Pure return-destination logic for the AI settings page — the `?next=` token
 * allowlist a successful key-connect uses to send the user onward. No DB, no
 * React, so it's shared by the route and directly unit-testable (mirrors
 * `#app/lib/onboarding`'s `resolveExitDestination`).
 *
 * Callers pass a short TOKEN (`?next=diary`), never a raw path, so a tampered
 * or off-app value can never become an open redirect.
 */

/** The `?next=` tokens a connect flow can return the user to. */
export const SETTINGS_RETURN_TOKENS = ['diary', 'scan', 'add'] as const;

export type SettingsReturnToken = (typeof SETTINGS_RETURN_TOKENS)[number];

/** The in-app path each return token resolves to. */
const RETURN_PATH_BY_TOKEN = {
  diary: '/diary',
  scan: '/scan',
  add: '/add',
} satisfies Record<SettingsReturnToken, string>;

/**
 * Resolves a `?next=` token to its in-app path, or `null` when the token is
 * absent or unrecognized — a `null` means "no explicit return target" (the
 * caller decides its own fallback), never a fabricated redirect.
 *
 * @param token - the raw `?next=` query value.
 * @returns the allowlisted in-app path, or `null`.
 */
export function resolveSettingsReturnPath(token: string | null): string | null {
  const matched = SETTINGS_RETURN_TOKENS.find((candidate) => candidate === token);
  return matched === undefined ? null : RETURN_PATH_BY_TOKEN[matched];
}
