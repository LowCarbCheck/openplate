/**
 * The allergen fieldset (M219/02): fourteen toggle chips, one per EU 14
 * allergen, and the sentence under them that says what a chip is not.
 *
 * ── Why it is a component rather than JSX in two routes ────────────────────
 *
 * The "About you" settings page and the onboarding body step ask this same
 * question (D4c), and `ReproductiveStatusFields` is the worked example of what
 * happens when two screens hand-copy one fieldset: they drift. Fourteen chips
 * and a disclaimer are more than enough to drift again.
 *
 * ── Presentational, and strictly so ────────────────────────────────────────
 *
 * No store reads, no data hook: the list and its setter belong to the caller,
 * and the parent `Form` is what submits. Each chosen chip is a checked
 * `<input type="checkbox">` under ONE name, so the action reads the list with
 * `formData.getAll(name)` and narrows it through `parseAllergens`. That is what
 * lets `tests/unit/allergens.test.ts` render it through `renderToStaticMarkup`.
 *
 * ── The disclaimer is part of the fieldset, not of the page (D4a) ───────────
 *
 * The moment a person adds an allergy they are told the truth: openplate
 * checks only foods it recognised from a photo or a description, it can miss
 * hidden ingredients, and it is not a safety check. It is rendered HERE, under
 * the chips, so it shows wherever the chips show. A person who trusts a chip
 * they should not trust is worse off than one who never saw it.
 */
import { useTranslation } from 'react-i18next';
import { ALLERGEN_VALUES } from '#app/models/allergens';
import type { Allergen } from '#app/models/allergens';

/** The `data-slot` the sentence under the chips carries, what the unit tier finds it by. */
export const ALLERGEN_DISCLAIMER_SLOT = 'allergen-disclaimer';

export interface AllergenFieldsProps {
  /** The chosen allergens as they stand in the form right now. */
  value: readonly Allergen[];
  onChange: (next: Allergen[]) => void;
  /** The checkbox group's form field name; the action reads every checked value under it. */
  name: string;
  /** The host page's chip styling, so this fieldset looks native on both screens. */
  chipClassName: (isSelected: boolean) => string;
}

/** The list with `allergen` added or removed, in catalog order so two devices never disagree about it. */
function toggleAllergen(current: readonly Allergen[], allergen: Allergen): Allergen[] {
  const next = new Set(current);
  if (next.has(allergen)) next.delete(allergen);
  else next.add(allergen);
  return ALLERGEN_VALUES.filter((candidate) => next.has(candidate));
}

export function AllergenFields({ value, onChange, name, chipClassName }: AllergenFieldsProps) {
  const { t } = useTranslation();

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('allergens.legend')}</legend>
      <p className="text-xs text-muted-foreground">{t('allergens.hint')}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {ALLERGEN_VALUES.map((allergen) => {
          const isSelected = value.includes(allergen);
          return (
            <label key={allergen} className={chipClassName(isSelected)}>
              <input
                type="checkbox"
                name={name}
                value={allergen}
                checked={isSelected}
                onChange={() => onChange(toggleAllergen(value, allergen))}
                className="sr-only"
              />
              {t(`allergens.name.${allergen}`)}
            </label>
          );
        })}
      </div>
      {/* Under the chips and inside the fieldset on purpose: it belongs to the
          question, so it cannot be left behind when the fieldset moves. */}
      <p className="text-xs text-muted-foreground" data-slot={ALLERGEN_DISCLAIMER_SLOT}>
        {t('allergens.disclaimer')}
      </p>
    </fieldset>
  );
}
