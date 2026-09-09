/**
 * The eating style radio list, its two conditional sub questions, and the
 * sourced caution note that goes under it (M210 specs 04 and 05).
 *
 * Presentational on purpose: it takes field names, values and callbacks and
 * renders markup. It reads no store, holds no fetcher and knows nothing about
 * Conform, which is what lets `renderToStaticMarkup` prove the gating (a carb
 * style shows the 20/50/100 step, a kcal style shows the target field) without
 * a DOM. The settings card owns the form, the intent and the save.
 *
 * The sub questions are GATED, not merely hidden: a style that does not own a
 * number renders no input for it, so the submission carries no stale answer
 * that `applyEatingStyle` would then have to ignore.
 */
import { useTranslation, Trans } from 'react-i18next';
import { EATING_STYLES, eatingStyle, STYLE_CAUTION_SOURCE_URL, type EatingStyleId } from '#app/lib/eating-style';
import { CARB_SUB_PRESETS } from '#app/lib/eating-style-form';
import { FieldError } from '#app/components/field-error';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { cn } from '#app/lib/utils';

/** The Conform metadata a sub question needs, passed as plain values so this file never imports Conform. */
export interface StyleFieldMeta {
  name: string;
  id: string;
  errorId: string;
  errors: string[] | undefined;
}

/** Everything the picker renders from. One options object: nine of the ten inputs would otherwise be same-typed positionals. */
export interface EatingStylePickerProps {
  selectedStyle: EatingStyleId;
  onSelectStyle: (style: EatingStyleId) => void;
  /** The radio group's field name, so the pick posts with the rest of the form. */
  styleFieldName: string;
  carbField: StyleFieldMeta;
  /** The picked ceiling as text, empty when nothing is picked yet. */
  carbPresetCeiling: string;
  onCarbPresetCeilingChange: (value: string) => void;
  kcalField: StyleFieldMeta;
  kcalTarget: string;
  onKcalTargetChange: (value: string) => void;
  /** True when the selected style scales by body weight and none is logged. */
  needsWeight: boolean;
}

/** One row of the style list. Bordered and tinted when picked, never a left rule. */
function styleRowClass(isSelected: boolean): string {
  return cn(
    'block cursor-pointer rounded-lg border p-3 transition-colors',
    isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
  );
}

/** The 20/50/100 chip recipe, matching the goals card's one-tap chips. */
function carbChipClass(isSelected: boolean): string {
  return cn(
    'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-4 py-2 text-xs font-medium transition-colors',
    isSelected ?
      'border-primary bg-primary text-primary-foreground'
    : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-foreground',
  );
}

export function EatingStylePicker({
  selectedStyle,
  onSelectStyle,
  styleFieldName,
  carbField,
  carbPresetCeiling,
  onCarbPresetCeilingChange,
  kcalField,
  kcalTarget,
  onKcalTargetChange,
  needsWeight,
}: EatingStylePickerProps) {
  const { t } = useTranslation();
  const definition = eatingStyle(selectedStyle);

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('onboarding.style.title')}</legend>
        <div className="space-y-2 pt-1">
          {EATING_STYLES.map((style) => {
            const isSelected = style.id === selectedStyle;
            return (
              <label key={style.id} className={styleRowClass(isSelected)}>
                <input
                  type="radio"
                  name={styleFieldName}
                  value={style.id}
                  checked={isSelected}
                  onChange={() => onSelectStyle(style.id)}
                  className="sr-only"
                />
                <span className="block text-sm font-medium">{t(style.labelKey)}</span>
                <span className="block text-xs text-muted-foreground">{t(style.detailKey)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Asked only by the two carb styles, and mandatory once asked: a carb
          lens with no ceiling would grade the day against nothing. */}
      {definition.carbSubPreset && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('onboarding.carbPreset.legend')}</legend>
          <div className="flex flex-wrap gap-2 pt-1">
            {CARB_SUB_PRESETS.map((preset) => {
              const value = String(preset.ceiling);
              const isSelected = carbPresetCeiling === value;
              return (
                <label key={preset.id} className={carbChipClass(isSelected)}>
                  <input
                    type="radio"
                    name={carbField.name}
                    value={value}
                    checked={isSelected}
                    onChange={() => onCarbPresetCeilingChange(value)}
                    className="sr-only"
                  />
                  {t('onboarding.carbPreset.chipWithCeiling', { label: t(preset.labelKey), ceiling: preset.ceiling })}
                </label>
              );
            })}
          </div>
          <FieldError id={carbField.errorId} errors={carbField.errors} />
        </fieldset>
      )}

      {/* Asked only by the two kcal styles. No TDEE formula stands in for a
          missing answer here (M210 design), so the field is required. */}
      {definition.kcalMode === 'asked' && (
        <div className="space-y-2">
          <Label htmlFor={kcalField.id}>{t('goals.kcal.label')}</Label>
          <Input
            id={kcalField.id}
            name={kcalField.name}
            inputMode="numeric"
            placeholder={t('goals.kcal.placeholder')}
            value={kcalTarget}
            onChange={(event) => onKcalTargetChange(event.target.value)}
            aria-describedby={kcalField.errorId}
            aria-invalid={kcalField.errors?.length ? true : undefined}
            className="h-11 sm:h-9"
          />
          <FieldError id={kcalField.errorId} errors={kcalField.errors} />
        </div>
      )}

      {needsWeight && <p className="text-xs text-muted-foreground">{t('onboarding.style.needsWeight')}</p>}
    </div>
  );
}

/**
 * The pregnancy and lactation note (M210 spec 04). Information, never an
 * instruction, and never a number: muted body text with one source link, no
 * colour, no panel, no block on the style it appears beside.
 *
 * Rendered only when `styleCaution` returned a key, which the caller decides,
 * so this component can never invent a reason to appear.
 */
export function EatingStyleCautionNote() {
  const { t } = useTranslation();

  return (
    <p className="text-xs text-muted-foreground">
      <Trans
        i18nKey="onboarding.style.caution"
        components={{
          source: (
            <a
              href={STYLE_CAUTION_SOURCE_URL}
              target="_blank"
              rel="noopener"
              aria-label={t('onboarding.style.sourceLabel')}
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              {/* Replaced by the linked run from the catalog entry. */}
              source
            </a>
          ),
        }}
      />
    </p>
  );
}
