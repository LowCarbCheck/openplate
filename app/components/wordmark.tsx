import type { HTMLAttributes, ReactElement } from 'react';

import { APP_NAME } from '#app/lib/brand';
import { cn } from '#app/lib/utils';

type WordmarkProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  /** `h1` only for the landing page, where the wordmark IS the page's heading. */
  as?: 'span' | 'h1';
  /**
   * Set when the word sits in a row beside the mark. Lifts it so the middle of its lowercase
   * letters, and not the middle of its line box, is on the mark's centre. Leave it off where no
   * mark is beside the word: the phone header's kicker and the landing heading.
   */
  besideMark?: boolean;
  /**
   * The boot screen's animation: every letter becomes its own span, "open" stays teal and the
   * letters of "plate" take the teal in turn and hand it back. The word is then decoration, so it
   * is hidden from screen readers here, and the caller's own label speaks for the screen.
   */
  wave?: boolean;
};

/** Where the word breaks in two. "open" is teal, "plate" takes the ink of the place it sits in. */
const OPEN_LENGTH = 'open'.length;

/** How far each letter of the wave starts behind the one before it, in seconds. */
const WAVE_STEP_S = 0.1;

/**
 * The nine letters, one span each. The delay counts across the whole word, so "p" starts at
 * 0.4 s and "e" at 0.8 s. The keyframe and the reduced-motion opt-in live in `app.css` under
 * `.wordmark-wave`; with motion reduced the class draws nothing and "plate" keeps its ink.
 */
function WaveLetters(): ReactElement[] {
  return [...APP_NAME].map((letter, index) => {
    const key = `${index}${letter}`;
    if (index < OPEN_LENGTH) {
      return (
        <span key={key} className="text-primary">
          {letter}
        </span>
      );
    }
    return (
      <span key={key} className="wordmark-wave" style={{ animationDelay: `${(index * WAVE_STEP_S).toFixed(1)}s` }}>
        {letter}
      </span>
    );
  });
}

/**
 * The word "openplate", the product's own name, and the only element in the app that draws it.
 *
 * THE RECIPE, decided by the operator on 2026-09-21 after judging it against the real fonts in
 * the brand repo's playground (since deleted): Victor Mono at its lowest weight, 100, with the
 * tracking pulled in to -0.03em, "open" in brand teal and "plate" in the surrounding ink. Every
 * part of it lives HERE, so no caller passes a weight, a tracking or a colour for the word and no
 * two places can drift. Size stays with the caller through `className`, because the sidebar, the
 * drawer, the public header, onboarding and the landing hero each set the word at their own scale.
 *
 * WHY A ROLE AND NOT THE BODY CLASS. `font-display` resolves to `--font-brand` in app.css, which
 * today names the same Victor Mono the body uses. It stays a role of its own so that changing the
 * face of the name is still one line, and `tests/unit/wordmark-brand-role.test.ts` fails if the
 * class appears in any other file under `app/`. The face was Fraunces until 2026-09-21.
 *
 * WHY THE WEIGHT IS SAFE ON A MONOSPACE FACE. Every letter is 0.6em wide at every weight, so the
 * word is the same width in Thin as in Bold and the row around it never reflows.
 *
 * WHY `besideMark` LIFTS BY 0.08em. The letters of a lowercase word sit on a baseline, and a
 * flex row centres the line BOX, so the eye sees the word hanging low against the mark. 0.08em is
 * measured at weight 100: it puts the middle of the x-height on the mark's centre. In pixels that
 * is 1.4 at 18. `tests/e2e/wordmark.spec.ts` reads the real page and holds it to a pixel.
 *
 * WHY `wave` SPLITS THE WORD HERE. The boot screen animates the word letter by letter, and the
 * colour of "open" is part of the recipe above. Splitting in the caller would type that colour a
 * second time. The letters change colour only, so the word keeps its width while it runs.
 *
 * WHY IT TAKES NO CHILDREN. The face is for the word, so the word is not a parameter. A caller
 * that wants another string in the brand face has to change this file, which is exactly the
 * review that decision deserves.
 */
export function Wordmark({
  as: Tag = 'span',
  besideMark = false,
  wave = false,
  className,
  ...props
}: WordmarkProps): ReactElement {
  const classes = cn('font-display font-thin tracking-[-0.03em]', besideMark && 'relative top-[-0.08em]', className);
  if (wave) {
    return (
      <Tag className={classes} {...props} aria-hidden="true">
        <WaveLetters />
      </Tag>
    );
  }
  return (
    <Tag className={classes} {...props}>
      <span className="text-primary">{APP_NAME.slice(0, OPEN_LENGTH)}</span>
      {APP_NAME.slice(OPEN_LENGTH)}
    </Tag>
  );
}
