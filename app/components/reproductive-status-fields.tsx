/**
 * The reproductive-status fieldset (M206/02): the three chips, the one date
 * field the chosen chip reveals, and a line of plain text saying what that date
 * means today.
 *
 * ── Why it is a component rather than JSX in two routes ────────────────────
 *
 * `/settings/goals` and the onboarding body step ask this same question, and
 * before M206 they asked it with two hand-copied `fieldset`s that had already
 * drifted in their chip classes. A date field, a helper input and a derived
 * line are more than enough to drift again, and the two screens would then
 * disagree about what a person may enter about their own pregnancy.
 *
 * ── Presentational, and strictly so ────────────────────────────────────────
 *
 * No store reads, no clock, no i18next singleton and no data hook: `today`
 * arrives as a `YYYY-MM-DD` day key from whichever loader owns the person's
 * time zone, the value and its setter belong to the caller, and the only state
 * held here is the weeks-along box, which is a typing aid and is never stored.
 * That is what lets `tests/unit/reproductive-status-fields.test.ts` render it
 * through `renderToStaticMarkup` in every state.
 *
 * ── The gate is HERE, and it is `!== 'male'` ───────────────────────────────
 *
 * Anyone who did not answer "male" is asked, including "prefer not to say" and
 * no answer at all (widened in M206, matching `normalizeBodyMetrics`). The
 * earlier `=== 'female'` rule made a pregnant person choose between telling
 * this app their sex and recording a pregnancy at all.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError } from '#app/components/field-error';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { dueDateFromWeeksAlong, resolveGestation, resolveLactationMonths } from '#app/lib/reproductive-stage';
import type { Trimester } from '#app/lib/reproductive-stage';
import { REPRODUCTIVE_STATUS_VALUES } from '#app/models/body-metrics';

/** The three raw form strings this fieldset owns. */
export interface ReproductiveStatusValue {
  reproductiveStatus: string;
  pregnancyDueDate: string;
  lactationStartDate: string;
}

/**
 * One date input's wiring. `id` and `name` differ under Conform (which prefixes
 * ids per form), so both are supplied rather than derived from each other, and
 * the error pair comes straight off the field metadata on the settings page.
 */
export interface ReproductiveDateFieldProps {
  name: string;
  id: string;
  errorId?: string;
  errors?: string[];
}

export interface ReproductiveStatusFieldsProps {
  /** The biological sex answer as it stands in the form right now; `'male'` hides everything. */
  biologicalSex: string | null;
  value: ReproductiveStatusValue;
  onChange: (next: ReproductiveStatusValue) => void;
  /** The caller's calendar day as `YYYY-MM-DD`; never read from a clock here. */
  today: string;
  /** The radio group's form field name. */
  statusName: string;
  dueDateField: ReproductiveDateFieldProps;
  lactationStartDateField: ReproductiveDateFieldProps;
  /** The host page's chip styling, so this fieldset looks native on both screens. */
  chipClassName: (isSelected: boolean) => string;
}

/** Full term, the week the "weeks along" helper counts back from. Copy only; the arithmetic is `dueDateFromWeeksAlong`. */
const FULL_TERM_WEEKS = 40;

/** The i18n key naming a trimester, so the derived line reads as a sentence rather than as "trimester 2". */
function trimesterNameKey(trimester: Trimester): string {
  if (trimester === 1) return 'bodyMetrics.reproductive.trimester.first';
  if (trimester === 2) return 'bodyMetrics.reproductive.trimester.second';
  return 'bodyMetrics.reproductive.trimester.third';
}

export function ReproductiveStatusFields({
  biologicalSex,
  value,
  onChange,
  today,
  statusName,
  dueDateField,
  lactationStartDateField,
  chipClassName,
}: ReproductiveStatusFieldsProps) {
  const { t } = useTranslation();
  // The typed week count, not the stored one. It writes a due date and is then
  // forgotten: there is exactly one stored field, and it is the date.
  const [weeksAlong, setWeeksAlong] = useState('');

  if (biologicalSex === 'male') return null;

  const isPregnant = value.reproductiveStatus === 'pregnant';
  const isLactating = value.reproductiveStatus === 'lactating';

  function handleWeeksAlongChange(raw: string) {
    setWeeksAlong(raw);
    const weeks = Number(raw.trim());
    if (raw.trim() === '' || !Number.isInteger(weeks)) return;
    if (weeks < 1 || weeks > FULL_TERM_WEEKS) return;
    onChange({ ...value, pregnancyDueDate: dueDateFromWeeksAlong({ weeks, today }) });
  }

  const gestation = isPregnant ? resolveGestation({ dueDate: value.pregnancyDueDate, today }) : null;
  const lactationMonths = isLactating ? resolveLactationMonths({ startDate: value.lactationStartDate, today }) : null;

  const derivedLine =
    gestation !== null ?
      t('bodyMetrics.reproductive.derivedTrimester', {
        trimester: t(trimesterNameKey(gestation.trimester)),
        week: gestation.week,
      })
    : lactationMonths !== null ? t('bodyMetrics.reproductive.derivedMonths', { count: lactationMonths })
    : t('bodyMetrics.reproductive.derivedNotSet');

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('bodyMetrics.reproductive.legend')}</legend>
      <p className="text-xs text-muted-foreground">{t('bodyMetrics.reproductive.hint')}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {REPRODUCTIVE_STATUS_VALUES.map((option) => (
          <label key={option} className={chipClassName(value.reproductiveStatus === option)}>
            <input
              type="radio"
              name={statusName}
              value={option}
              checked={value.reproductiveStatus === option}
              onChange={() => onChange({ ...value, reproductiveStatus: option })}
              className="sr-only"
            />
            {t(`bodyMetrics.reproductive.${option}`)}
          </label>
        ))}
      </div>

      {isPregnant && (
        <div className="space-y-2 pt-2">
          <Label htmlFor={dueDateField.id}>{t('bodyMetrics.reproductive.dueDate.label')}</Label>
          <p className="text-xs text-muted-foreground">{t('bodyMetrics.reproductive.dueDate.hint')}</p>
          <Input
            id={dueDateField.id}
            name={dueDateField.name}
            type="date"
            value={value.pregnancyDueDate}
            onChange={(event) => onChange({ ...value, pregnancyDueDate: event.target.value })}
            aria-invalid={dueDateField.errors && dueDateField.errors.length > 0 ? true : undefined}
            aria-describedby={dueDateField.errors && dueDateField.errors.length > 0 ? dueDateField.errorId : undefined}
            className="h-11 sm:h-9"
          />
          <FieldError id={dueDateField.errorId} errors={dueDateField.errors} />

          <Label htmlFor={`${dueDateField.id}-weeks`}>{t('bodyMetrics.reproductive.weeksAlong.label')}</Label>
          <p className="text-xs text-muted-foreground">{t('bodyMetrics.reproductive.weeksAlong.hint')}</p>
          {/*
            Deliberately nameless: it submits nothing. Typing a week count fills
            the date field above and the date is what gets stored, so the record
            keeps advancing on its own instead of freezing at the week somebody
            typed once.
          */}
          <Input
            id={`${dueDateField.id}-weeks`}
            type="number"
            inputMode="numeric"
            min={1}
            max={FULL_TERM_WEEKS}
            value={weeksAlong}
            onChange={(event) => handleWeeksAlongChange(event.target.value)}
            className="h-11 sm:h-9"
          />
        </div>
      )}

      {isLactating && (
        <div className="space-y-2 pt-2">
          <Label htmlFor={lactationStartDateField.id}>{t('bodyMetrics.reproductive.startDate.label')}</Label>
          <p className="text-xs text-muted-foreground">{t('bodyMetrics.reproductive.startDate.hint')}</p>
          <Input
            id={lactationStartDateField.id}
            name={lactationStartDateField.name}
            type="date"
            value={value.lactationStartDate}
            onChange={(event) => onChange({ ...value, lactationStartDate: event.target.value })}
            aria-invalid={
              lactationStartDateField.errors && lactationStartDateField.errors.length > 0 ? true : undefined
            }
            aria-describedby={
              lactationStartDateField.errors && lactationStartDateField.errors.length > 0 ?
                lactationStartDateField.errorId
              : undefined
            }
            className="h-11 sm:h-9"
          />
          <FieldError id={lactationStartDateField.errorId} errors={lactationStartDateField.errors} />
        </div>
      )}

      {(isPregnant || isLactating) && <p className="text-xs text-muted-foreground">{derivedLine}</p>}
    </fieldset>
  );
}
