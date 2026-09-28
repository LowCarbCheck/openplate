/**
 * The instance's reference basis, as a form (M234 spec 07).
 *
 * ── PRESENTATIONAL, like every other `/admin` screen ─────────────────────
 *
 * It takes what the handshake said and a callback, and it holds nothing but
 * the form's own state. The route above it owns the admin client, the call and
 * the outcome, which is what lets this file be rendered in the unit tier with
 * `renderToStaticMarkup` and no session, no server and no network.
 *
 * ── THE RELOAD SENTENCE IS PART OF THE FORM, not a footnote ──────────────
 *
 * The handshake is read ONCE PER TAB (`use-server-instance.ts`), so the
 * administrator who saves a new basis keeps seeing the old numbers on their own
 * screen, and so does everybody else who already has the app open. That is
 * surprising enough to be mistaken for a failed save, so it is stated in the
 * card rather than discovered.
 *
 * ── A SERVER THAT PUBLISHES NO BASIS GETS NO FORM ────────────────────────
 *
 * `basis === null` is a service older than M234, or a self-hoster running no
 * core at all. Its `PATCH /v1/admin/settings` answers the ordinary 404, so a
 * form here would be a control that cannot work. It says so instead, and the
 * nutrient screen keeps taking whatever that instance's own default is.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { getFormProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import { Loader2 } from 'lucide-react';

import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import {
  BASIS_LABEL_KEY,
  makeInstanceSettingsSchema,
  type InstanceSettingsFormValues,
} from '#app/lib/admin/settings-schema';
import { NUTRIENT_REFERENCE_BASES, type NutrientReferenceBasis } from '#app/lib/admin/admin-wire';

/** What the card is doing. `saved` is the state a reload sentence belongs to, so it is not merged into `form`. */
export type InstanceSettingsState = 'form' | 'working' | 'saved';

export interface InstanceSettingsCardProps {
  /** What the handshake said this instance shows, or `null` when it said nothing at all. */
  basis: NutrientReferenceBasis | null;
  state: InstanceSettingsState;
  /** A sentence about a call that did not go through, or `null`. */
  failure: string | null;
  onSubmit: (values: InstanceSettingsFormValues) => void;
}

export function InstanceSettingsCard({ basis, state, failure, onSubmit }: InstanceSettingsCardProps): ReactElement {
  const { t } = useTranslation();

  const [form, fields] = useForm({
    id: 'admin-instance-settings',
    defaultValue: { nutrientReferenceBasis: basis ?? '' },
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: makeInstanceSettingsSchema(t) });
    },
    shouldRevalidate: 'onInput',
    onSubmit(event, { submission }) {
      event.preventDefault();
      if (submission?.status !== 'success') return;
      onSubmit(submission.value);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.settings.title')}</CardTitle>
        <CardDescription>{t('admin.settings.body')}</CardDescription>
      </CardHeader>
      <CardContent>
        {basis === null ?
          <p className="text-sm text-muted-foreground">{t('admin.settings.unavailable')}</p>
        : <form {...getFormProps(form)} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('admin.settings.basisLegend')}</legend>
              <div className="space-y-2 pt-1">
                {NUTRIENT_REFERENCE_BASES.map((option) => (
                  <label key={option} className="flex items-start gap-3 text-sm">
                    <input
                      type="radio"
                      name={fields.nutrientReferenceBasis.name}
                      value={option}
                      defaultChecked={option === basis}
                      className="mt-1 h-4 w-4"
                    />
                    <span>{t(BASIS_LABEL_KEY[option])}</span>
                  </label>
                ))}
              </div>
              {fields.nutrientReferenceBasis.errors !== undefined && (
                <p className="text-sm text-red-600 dark:text-red-400">{fields.nutrientReferenceBasis.errors}</p>
              )}
            </fieldset>

            {/* Said here, in the form, and in the same size as everything else
                in it: an administrator who saves and then looks at the nutrient
                screen in this tab sees the OLD numbers, and would otherwise read
                that as a failed save. */}
            <p className="text-sm text-muted-foreground">{t('admin.settings.reloadNotice')}</p>

            {state === 'saved' && <p className="text-sm font-medium">{t('admin.settings.saved')}</p>}
            {failure !== null && <p className="text-sm text-red-600 dark:text-red-400">{failure}</p>}

            <Button type="submit" className="h-11" disabled={state === 'working'}>
              {state === 'working' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {state === 'working' ? t('admin.settings.saving') : t('admin.settings.submit')}
            </Button>
          </form>
        }
      </CardContent>
    </Card>
  );
}
