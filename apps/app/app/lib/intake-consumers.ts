/**
 * The three intake hub addresses (ADR-0019), spelled once.
 *
 * This is the leaf of the intake flow's module graph, no imports of its own,
 * which is why the three route addresses live here rather than in
 * `intake-hrefs.ts`: that module already imports `IntakeConsumer` from this
 * one, and a constant flowing the other way would make the two modules
 * import each other, a cycle whose evaluation order is not something either
 * file controls. `intake-hrefs.ts` re-exports these three for anything that
 * reaches for a route address where it is already importing `buildIntakeHref`.
 */
export const ADD_SEARCH_PATH = '/add/search';
export const ADD_DESCRIBE_PATH = '/add/describe';
export const ADD_PHOTO_PATH = '/add/photo';

/**
 * Who may receive an intake, written once as an allowlist.
 *
 * `/add/describe` parks what a person typed or dictated and then LEAVES for
 * the screen that will do something with it. Which screen that is arrives in
 * the URL, as `?to=`, because the composer is reached by a plain link and a
 * link carries nothing else. The diary asks for `/add/photo`; the pantry asks
 * for `/pantry`.
 *
 * A PATH THAT COMES OUT OF A QUERY STRING IS UNTRUSTED. Navigating straight to
 * whatever `?to=` holds turns this screen into an open redirect: a link of the
 * form `/add/describe?to=//example.com` would hand the person, and whatever
 * they just wrote, to a site the app has never heard of. So the parameter is
 * not a destination, it is a NAME, and only the names in this list resolve.
 * Anything else, including an absolute URL, a protocol-relative one and an
 * unknown in-app path, falls back to `/add/photo`, which is where this screen
 * went before the parameter existed.
 *
 * Adding a consumer is one entry here. The list stays short on purpose: every
 * entry is a screen that knows how to read `takeIntakeHandoff`.
 */

/** Every screen `/add/describe` may hand words to. The first is the default. */
export const INTAKE_CONSUMERS = [ADD_PHOTO_PATH, '/pantry'] as const;

/** One of the screens above. Never a bare string, so a typo is a compile error. */
export type IntakeConsumer = (typeof INTAKE_CONSUMERS)[number];

/** Where an intake goes when the URL says nothing, or says something this app does not own. */
export const DEFAULT_INTAKE_CONSUMER: IntakeConsumer = ADD_PHOTO_PATH;

/**
 * The consumer a `?to=` parameter names.
 *
 * @param value - the raw query parameter, `null` when it is absent.
 * @returns the named consumer, or `/add/photo` for anything outside the list.
 */
export function parseIntakeConsumer(value: string | null): IntakeConsumer {
  if (value === null) return DEFAULT_INTAKE_CONSUMER;
  const named = INTAKE_CONSUMERS.find((consumer) => consumer === value);
  return named ?? DEFAULT_INTAKE_CONSUMER;
}
