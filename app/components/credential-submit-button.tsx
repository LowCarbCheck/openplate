/**
 * THE SUBMIT CONTROL OF EVERY CREDENTIAL FORM, disabled until the page has
 * hydrated.
 *
 * ── The threat ───────────────────────────────────────────────────────────
 *
 * Submit a credential form BEFORE the page hydrates and no JavaScript runs, so
 * nothing calls `preventDefault` and the browser performs a native submit.
 * These forms carry no `method`, so that is a GET: the passphrase goes into the
 * address bar as `?passphrase=…`, and from there into history, into every log
 * on the path, and into the next request's `Referer`. That passphrase derives
 * the encryption keys for the person's whole diary, and this app's own server
 * is designed never to see it. Observed twice in a real browser on `/sign-in`,
 * 2026-09-08.
 *
 * ── Why the two obvious fixes are not fixes ──────────────────────────────
 *
 * `method="post"` would move the passphrase out of the URL and into a request
 * BODY posted to this app's server, the one place it must never arrive. That
 * is a different leak wearing the shape of a fix; do not "improve" this that
 * way.
 *
 * An `onSubmit` handler cannot help either. Before hydration there is no
 * JavaScript at all, so no handler of any kind runs. The only thing that can
 * prevent a pre-hydration submit is the SERVER-RENDERED MARKUP, which is why
 * the guard is a `disabled` attribute rather than any kind of code.
 *
 * ── What `disabled` buys, including the part people miss ─────────────────
 *
 * The click path, obviously. And the Enter-in-a-text-field path: HTML implicit
 * submission goes through the form's default button, and a disabled default
 * button means Enter does nothing.
 *
 * ── The accepted cost ────────────────────────────────────────────────────
 *
 * If the client bundle never runs, this button never enables and signing in is
 * impossible. That is ALREADY true of this app: key derivation is entirely
 * client side, every one of these forms calls `preventDefault` and does its
 * work in the browser, so a form that looked usable without JavaScript was
 * lying about it. No copy is added to explain the disabled state, because
 * there is nothing a person can do about the half-second it lasts.
 */
import type { ReactNode } from 'react';

import { Button } from '#app/components/ui/button';
import { useHydrated } from '#app/hooks/use-hydrated';

export function CredentialSubmitButton({
  children,
  className,
  disabled = false,
}: {
  children: ReactNode;
  className?: string;
  /** The form's own reason to refuse, e.g. a request already in flight. ORed with the hydration guard. */
  disabled?: boolean;
}) {
  const isHydrated = useHydrated();

  return (
    <Button
      type="submit"
      // A stable anchor for the unit tier, which has no DOM and reads markup:
      // it survives every rewording and restyling of the button itself.
      data-credential-submit=""
      className={className}
      disabled={disabled || !isHydrated}
    >
      {children}
    </Button>
  );
}
