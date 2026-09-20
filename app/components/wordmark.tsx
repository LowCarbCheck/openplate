import type { HTMLAttributes, ReactElement } from 'react';

import { APP_NAME } from '#app/lib/brand';
import { cn } from '#app/lib/utils';

type WordmarkProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  /** `h1` only for the landing page, where the wordmark IS the page's heading. */
  as?: 'span' | 'h1';
};

/**
 * The word "openplate", set in the brand face. The only element in the app that asks
 * for it.
 *
 * WHY ONE COMPONENT. The display serif (Fraunces, the `--font-brand` role in app.css,
 * exposed as the `font-display` utility) used to sit on every card title, the header page
 * title, a live number and nine landing headings. A serif used once, on the product's own
 * name, is a signature; a serif on everything is the template tell M243 removed. Making the
 * component the ONLY place the class is written turns "the serif is a logotype" from a
 * convention into a fact a test can hold: `tests/unit/wordmark-only-serif.test.ts` fails
 * if `font-display` appears in any other file under `app/`.
 *
 * WHY IT TAKES NO CHILDREN. The face is for the word, so the word is not a parameter. A
 * caller that wants another string in the serif has to change this file, which is exactly
 * the review that decision deserves.
 *
 * Size, weight and colour stay with the caller through `className`: the sidebar, the
 * drawer, the header kicker, the public header, onboarding and the landing hero each set
 * the wordmark at their own scale.
 */
export function Wordmark({ as: Tag = 'span', className, ...props }: WordmarkProps): ReactElement {
  return (
    <Tag className={cn('font-display', className)} {...props}>
      {APP_NAME}
    </Tag>
  );
}
