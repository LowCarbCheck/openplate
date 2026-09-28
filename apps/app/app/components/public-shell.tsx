import type { ReactNode } from 'react';
import PublicWrapper from '#app/components/public-wrapper';
import { H1 } from '#app/components/typography';

/**
 * THE ONE PUBLIC SHELL, shared by both layouts (M204 spec 09).
 *
 * `_public.tsx` has always worn `PublicWrapper`: the header with the wordmark
 * and, on a managed instance, the sign-in door; the centred main column; the
 * footer with the imprint, the privacy page and the source. `_personal.tsx`
 * now wears the same chrome for a stranger on a gate-exempt settings page, and
 * this component is what makes that literally the same chrome rather than a
 * second minimal shell that would drift from it. A footer link added for a
 * legal reason has to appear on both, and there is only one place to add it.
 *
 * The only thing this adds over `PublicWrapper` is the page's own heading,
 * which the app shell draws in its header bar and the public chrome does not
 * draw at all. Rendered only when a title is passed, so `_public.tsx`'s use is
 * byte-identical to the `PublicWrapper` it replaced.
 */
export function PublicShell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <PublicWrapper>
      {title ? <H1 className="mb-6">{title}</H1> : null}
      {children}
    </PublicWrapper>
  );
}
