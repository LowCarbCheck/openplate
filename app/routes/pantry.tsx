/**
 * `/pantry`, what is in the fridge (M233/02).
 *
 * ── One screen, two arrivals ─────────────────────────────────────────────
 *
 * A person reaches this route either WITH an intake or WITHOUT one, and the
 * difference is the whole structure of the file.
 *
 * With: the intake composer on `/dashboard` or on this page pointed its camera
 * or its words here, `intake-handoff.ts` is holding them, and this screen runs
 * the pantry task and shows what came back as an editable review form. Confirm
 * folds it into the stored list; cancel throws the reading away and the stored
 * list is untouched.
 *
 * Without: the stored list itself, in the SAME editable rows, plus the
 * composer and a door to the recipes (spec 04).
 *
 * ── The rows are one component, not two ──────────────────────────────────
 *
 * A review form and a list editor are the same object here: a name, an amount,
 * a unit, a remove control and a way to add a line. Writing them twice would
 * be two places to fix the amount rules, so `PantryRows` is prop-driven and
 * both arrivals render it. Everything that decides what a person sees is a
 * PROP, never a hook read, so every state is renderable in a test (this repo
 * has no DOM test library; see `describe.tsx` for the same split and why).
 *
 * ── Client-only, like every tracker surface ──────────────────────────────
 *
 * The provider call is this browser's own (BYOK, or the account's allowance on
 * a managed instance) and the list lives in the on-device primary store, so
 * there is nothing for a server loader to do. The not-connected card and the
 * failure alert are `/scan`'s, shared rather than copied
 * (`components/intake/`), because a second set of sentences about one missing
 * connection would drift the first time the allowance rules moved.
 *
 * ── The pantry never reaches a food log ──────────────────────────────────
 *
 * Nothing here writes a `LocalFoodLog` or a `LocalPersonalFood`. A pantry row
 * is a thing somebody HAS, and turning it into a thing they ATE is spec 04's
 * job, through the diary's own store functions.
 */
import type { Route } from './+types/pantry';
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';

import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#app/components/ui/select';
import { IntakeComposer } from '#app/components/intake/intake-composer';
import { ConnectCard, ScanLoading } from '#app/components/intake/intake-connect-card';
import { IntakeFailureAlert } from '#app/components/intake/intake-failure-alert';
import { useEffectiveAiSettings } from '#app/hooks/use-effective-ai-settings';
import { managedAiCredential, type EffectiveAiSettings } from '#app/lib/ai/managed-ai-settings';
import { newIntakeId } from '#app/lib/plans/trial-scans';
import { resolveProviderTriple } from '#app/lib/ai/provider-triple';
import { ADD_DESCRIBE_PATH, buildIntakeHref } from '#app/lib/intake-hrefs';
import { takeIntakeHandoff, type ScanHandoff } from '#app/lib/intake-handoff';
import { nextPantry, type PantryDraftRow } from '#app/lib/pantry-merge';
import { displayFoodName, pinShownFoodName } from '#app/lib/food-name';
import { trackPantryCaptured, type PantryCapturePath } from '#app/lib/matomo-events';
import { noteActivity } from '#app/lib/gamification/record';
import { fileToBase64 } from '#app/lib/file-to-base64';
import {
  getLocalAiSettings,
  listLocalPantryItems,
  recordLocalAiUsageEvent,
  replaceLocalPantry,
} from '#app/lib/local-store';
import type { LocalPantryItem, PantryUnit } from '#app/lib/local-store';
import {
  createVisionProvider,
  pantryPhotoTask,
  pantryTextTask,
  PANTRY_UNITS,
  VisionProviderError,
  type PantryIdentification,
  type ScanTokenUsage,
} from '#app/services/vision';
import { estimateScanCostUsd } from '#app/services/vision/cost';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { toLanguageCode, type LanguageCode } from '#app/i18n/language-prefs';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.pantry') }];

export const handle = {
  title: 'Pantry',
  titleKey: 'pantry.title',
  backTo: '/dashboard',
};

/** The composer's own links, so the strip on this page hands its intake back to this page. */
const PANTRY_DESCRIBE_HREF = buildIntakeHref(ADD_DESCRIBE_PATH, { to: '/pantry' });

/** Where the recipes live (spec 04). Named once so the disabled door and the live one cannot disagree. */
export const PANTRY_RECIPES_HREF = '/pantry/recipes';

export async function clientLoader() {
  const [settings, items] = await Promise.all([getLocalAiSettings(), listLocalPantryItems()]);
  return { settings, items };
}
clientLoader.hydrate = true as const;

export function HydrateFallback(): ReactElement {
  return <ScanLoading />;
}

////////////////////////////////////////////////////////////////////////////////
// The provider call
////////////////////////////////////////////////////////////////////////////////

/** What one pantry reading attempt answers with: rows, or a sentence saying why not. */
type PantryReadResult = { ok: true; identification: PantryIdentification } | { ok: false; error: string };

/**
 * Runs ONE pantry task against the person's provider and records the usage.
 *
 * The usage row is written on every outcome, including a failure that billed
 * tokens, the same rule `/scan`'s `recordAttempt` follows: a paid attempt that
 * produced nothing is still a paid attempt, and dropping it would make the
 * settings page's monthly figure quietly wrong.
 */
async function readPantry({
  handoff,
  effective,
  language,
  failedMessage,
}: {
  handoff: ScanHandoff;
  effective: EffectiveAiSettings;
  /** The app language at the moment of the call: the names come back in it (M251 spec 02). */
  language: LanguageCode;
  /** The generic "that did not work" sentence, already translated by the caller. */
  failedMessage: string;
}): Promise<PantryReadResult> {
  const triple = resolveProviderTriple(effective);
  if (triple === null) return { ok: false, error: failedMessage };

  const record = async (usage: ScanTokenUsage | undefined, outcome: 'identified' | 'no_foods' | 'error') => {
    await recordLocalAiUsageEvent({
      provider: triple.provider,
      model: triple.model,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      // `null` for a managed call, the honest answer rather than a missing
      // feature: the catalog prices a person's OWN provider key, and a managed
      // call is spent against an allowance their organization pays for.
      estimatedCostUsd:
        effective.source === 'managed' || usage === undefined ?
          null
        : (estimateScanCostUsd(triple.provider, triple.model, usage) ?? null),
      outcome,
    });
  };

  try {
    const provider = createVisionProvider({
      provider: triple.provider,
      model: triple.model,
      baseUrl: triple.baseUrl,
      // One intake id for this identify, the person's one action (M253/05).
      credential:
        effective.source === 'managed' ?
          managedAiCredential({ intakeId: newIntakeId() })
        : { apiKey: effective.settings.apiKey ?? '' },
    });
    const identification =
      handoff.kind === 'photo' ?
        await provider.runScan({
          task: pantryPhotoTask(language),
          image: { base64: await fileToBase64(handoff.file), mimeType: handoff.file.type },
        })
      : await provider.runTextIntake({ task: pantryTextTask(language), text: handoff.text });
    await record(identification.usage, identification.items.length === 0 ? 'no_foods' : 'identified');
    return { ok: true, identification };
  } catch (error) {
    const usage = error instanceof VisionProviderError ? error.usage : undefined;
    await record(usage, 'error');
    // A `VisionProviderError`'s own message is authored provider-neutrally in
    // the adapter layer and is already the actionable detail; anything else is
    // a throw this screen cannot explain, so it gets the generic sentence.
    return { ok: false, error: error instanceof VisionProviderError ? error.message : failedMessage };
  }
}

////////////////////////////////////////////////////////////////////////////////
// The rows
////////////////////////////////////////////////////////////////////////////////

/**
 * The row shape and the save rule both live in `#app/lib/pantry-merge`, which
 * is pure and has a unit test of its own. Re-exported here because this screen
 * is where a row is edited, so a reader of the file finds the type it renders.
 */
export type { PantryDraftRow };

/** The sentinel the unit select uses for "no unit", since a Radix item cannot carry an empty value. */
const NO_UNIT_VALUE = 'none';

/**
 * The unit a select answered with, as the closed set rather than a string.
 *
 * A lookup against the list, never an assertion: the Radix select's
 * `onValueChange` is typed `string`, and anything outside the four units
 * (including the "no unit" sentinel above) is a row with no unit, which is a
 * state the store already holds.
 */
function readUnitValue(value: string): PantryUnit | null {
  return PANTRY_UNITS.find((unit) => unit === value) ?? null;
}

/**
 * A stored item as a draft row, its name box showing the reader's language
 * (M251/03). See `PantryDraftRow.nameOrigin` for how an untouched row saves.
 */
export function draftFromStored(item: LocalPantryItem, language: string): PantryDraftRow {
  const shownName = displayFoodName(item, language);
  return {
    key: item.id,
    name: shownName,
    nameOrigin: { storedName: item.name, shownName, nameTranslations: item.nameTranslations },
    amount: item.amount === null ? '' : String(item.amount),
    unit: item.unit,
    category: item.category,
  };
}

/**
 * A freshly read item as a draft row, carrying the reading's translations with
 * the entry for the language on screen pinned to the name the box shows.
 */
export function draftFromReading(
  item: PantryIdentification['items'][number],
  key: string,
  language: string,
): PantryDraftRow {
  return {
    key,
    name: item.name,
    nameOrigin: {
      storedName: item.name,
      shownName: item.name,
      nameTranslations: pinShownFoodName({ translations: item.translations, name: item.name, language }),
    },
    amount: item.amount === null ? '' : String(item.amount),
    unit: item.unit,
    category: item.category,
  };
}

/** An empty line, for "add a line". */
function blankRow(key: string): PantryDraftRow {
  return { key, name: '', amount: '', unit: null, category: 'other' };
}

function PantryRows({
  rows,
  onChange,
}: {
  rows: readonly PantryDraftRow[];
  onChange: (rows: PantryDraftRow[]) => void;
}): ReactElement {
  const { t } = useTranslation();
  const nextKey = useRef(0);

  const patch = (key: string, change: Partial<PantryDraftRow>): void =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  return (
    // A FIXED TWO ROW SHAPE, not a wrapping flex row. Wrapping put the unit
    // select and the delete button side by side in the middle of the card, so
    // the button that throws a line away moved with the width of the unit
    // word beside it.
    <div className="space-y-3">
      {rows.map((row) => (
        <Card key={row.key}>
          <CardContent className="space-y-2 p-3">
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`pantry-name-${row.key}`} className="text-xs text-muted-foreground">
                  {t('pantry.review.nameLabel')}
                </Label>
                <Input
                  id={`pantry-name-${row.key}`}
                  className="h-11 sm:h-9"
                  value={row.name}
                  onChange={(event) => patch(row.key, { name: event.target.value })}
                />
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`pantry-amount-${row.key}`} className="text-xs text-muted-foreground">
                  {t('pantry.review.amountLabel')}
                </Label>
                <Input
                  id={`pantry-amount-${row.key}`}
                  className="h-11 sm:h-9"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) => patch(row.key, { amount: event.target.value })}
                />
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={`pantry-unit-${row.key}`} className="text-xs text-muted-foreground">
                  {t('pantry.review.unitLabel')}
                </Label>
                <Select
                  value={row.unit ?? NO_UNIT_VALUE}
                  onValueChange={(value) => patch(row.key, { unit: readUnitValue(value) })}
                >
                  <SelectTrigger id={`pantry-unit-${row.key}`} className="h-11 w-full sm:h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_UNIT_VALUE}>{t('pantry.review.unitNone')}</SelectItem>
                    {PANTRY_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {t(`pantry.units.${unit}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="ml-auto size-11 shrink-0"
                aria-label={t('pantry.review.removeAria', { name: row.name })}
                onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full sm:h-9"
        onClick={() => {
          nextKey.current += 1;
          onChange([...rows, blankRow(`new-${nextKey.current}`)]);
        }}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('pantry.review.addLine')}
      </Button>
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// The two arrivals
////////////////////////////////////////////////////////////////////////////////

/**
 * The stored list, its composer and the recipes door.
 *
 * PRESENTATIONAL AND PROP-DRIVEN, exported so a test can render every state
 * including the disabled door. An empty pantry gets the composer and one
 * sentence: a dashed empty box would be a container drawn around nothing, and
 * the composer already says what to do about it.
 */
export function PantryList({
  rows,
  onChange,
  onSave,
  isSaving,
  hasStoredItems,
  alert = null,
}: {
  rows: readonly PantryDraftRow[];
  onChange: (rows: PantryDraftRow[]) => void;
  onSave: () => void;
  isSaving: boolean;
  /** Anything that went wrong on the last save, rendered above the list. Null on an ordinary render. */
  alert?: ReactNode;
  /**
   * Whether the STORE holds anything, which is what the recipes door asks.
   *
   * Not `rows.length > 0`: a person who has just typed a line has not saved it
   * yet, and a door that opened on unsaved text would take them to recipes
   * built from a pantry the recipe screen cannot see.
   */
  hasStoredItems: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      {alert}
      <p className="text-sm text-muted-foreground">{hasStoredItems ? t('pantry.lead') : t('pantry.empty')}</p>
      {/* "Photo", not the diary's "Plate photo": this camera reads a shelf. */}
      <IntakeComposer
        describeTo={PANTRY_DESCRIBE_HREF}
        scanTo="/pantry"
        label={t('pantry.composerLabel')}
        photoLabel={t('launcher.photo')}
      />
      {hasStoredItems && (
        <>
          <PantryRows rows={rows} onChange={onChange} />
          <Button type="button" className="h-11 w-full sm:h-9" onClick={onSave} disabled={isSaving}>
            {isSaving ? t('pantry.review.saving') : t('pantry.review.saveList')}
          </Button>
        </>
      )}
      {/* THE DOOR TO THE RECIPES (spec 04). Disabled while the pantry is empty,
          and disabled means it does not navigate: a `Link` with
          `aria-disabled` still follows its href, so the empty state renders a
          `span` with no href at all rather than a link that looks refused and
          then goes anyway. */}
      {hasStoredItems ?
        <Link
          to={PANTRY_RECIPES_HREF}
          className="-my-3 inline-flex min-h-11 items-center gap-1 py-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('pantry.recipes.link')}
        </Link>
      : <span
          aria-disabled="true"
          className="-my-3 inline-flex min-h-11 cursor-not-allowed items-center gap-1 py-3 text-sm font-medium text-muted-foreground"
        >
          {t('pantry.recipes.link')}
        </span>
      }
    </div>
  );
}

/**
 * The review form for a fresh reading: the same rows, with confirm and cancel.
 *
 * Cancel is not "undo": nothing has been written, so it simply throws the
 * reading away and the stored list is exactly as it was. That is why it says
 * discard rather than cancel, and why it costs no confirmation dialog.
 */
export function PantryReview({
  rows,
  onChange,
  onConfirm,
  onDiscard,
  isSaving,
  notes,
  alert = null,
}: {
  rows: readonly PantryDraftRow[];
  onChange: (rows: PantryDraftRow[]) => void;
  onConfirm: () => void;
  onDiscard: () => void;
  isSaving: boolean;
  /** Anything the model said about the reading as a whole, or null. */
  notes: string | null;
  /**
   * Anything that went wrong on the last save, rendered above the rows.
   *
   * The reading STAYS ON SCREEN behind it: a store write that failed has
   * thrown nothing away, and a screen that fell back to the stored list would
   * lose a reading the person has already paid for and corrected.
   */
  alert?: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      {alert}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t('pantry.review.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('pantry.review.lead')}</p>
      </div>
      {notes !== null && <p className="text-xs text-muted-foreground">{notes}</p>}
      <PantryRows rows={rows} onChange={onChange} />
      <div className="flex gap-2">
        <Button type="button" className="h-11 flex-1 sm:h-9" onClick={onConfirm} disabled={isSaving}>
          {isSaving ? t('pantry.review.saving') : t('pantry.review.confirm')}
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1 sm:h-9" onClick={onDiscard} disabled={isSaving}>
          {t('pantry.review.discard')}
        </Button>
      </div>
    </div>
  );
}

////////////////////////////////////////////////////////////////////////////////
// The route
////////////////////////////////////////////////////////////////////////////////

/** What the screen is doing right now. One value, so "reading" and "failed" cannot both be true. */
type PantryPhase =
  | { kind: 'list' }
  | { kind: 'reading'; subject: 'photo' | 'text' }
  | { kind: 'review'; subject: 'photo' | 'text'; notes: string | null }
  | { kind: 'failed'; subject: 'photo' | 'text'; message: string };

export default function Pantry({ loaderData }: Route.ComponentProps): ReactElement {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const effective = useEffectiveAiSettings(loaderData.settings);
  const [stored, setStored] = useState<LocalPantryItem[]>(loaderData.items);
  const [rows, setRows] = useState<PantryDraftRow[]>(() => loaderData.items.map((item) => draftFromStored(item, i18n.language)));
  const [phase, setPhase] = useState<PantryPhase>({ kind: 'list' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Holds the freshest reader so the hand-off effect below can run it without
  // re-subscribing every render, the same pair `/scan` uses.
  const readRef = useRef<(handoff: ScanHandoff) => void>(() => {});

  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;

  useEffect(() => {
    readRef.current = (handoff: ScanHandoff) => {
      const subject = handoff.kind === 'photo' ? 'photo' : 'text';
      const settings = effectiveRef.current;
      // NO CONNECTION, so nothing was spent and nothing can be: the screen
      // falls back to the connect card below, which is the same answer `/scan`
      // gives, and the intake is dropped rather than parked for later.
      if (settings === null) return;
      setPhase({ kind: 'reading', subject });
      void (async () => {
        const result = await readPantry({
          handoff,
          effective: settings,
          language: toLanguageCode(i18n.language),
          failedMessage: t('pantry.errors.failed'),
        });
        if (!result.ok) {
          setPhase({ kind: 'failed', subject, message: result.error });
          return;
        }
        if (result.identification.items.length === 0) {
          setPhase({ kind: 'failed', subject, message: t('pantry.errors.nothingFound') });
          return;
        }
        setRows(result.identification.items.map((item, index) => draftFromReading(item, `read-${index}`, i18n.language)));
        setPhase({ kind: 'review', subject, notes: result.identification.notes ?? null });
      })();
    };
  });

  // THE HAND-OFF, taken on every ARRIVAL rather than once on mount.
  //
  // This screen is the one place that hands an intake to ITSELF: the composer
  // on it points its camera at `/pantry`, so a photograph taken here arrives
  // through a navigation to the route that is already mounted, and a
  // mount-only effect never runs again. The photo was then held forever and
  // the screen sat on its empty list as if nothing had been taken, which is
  // what `tests/e2e/pantry-to-recipe.spec.ts` walks.
  //
  // `location.key` is new for every navigation, including one to the same URL,
  // so it is the arrival itself. Nothing can be read twice: `takeIntakeHandoff`
  // empties the slot as it reads, so a re-render, a revalidation or a
  // StrictMode double-effect all find it empty and no intake is re-charged.
  useEffect(() => {
    const handed = takeIntakeHandoff();
    if (handed === null) return;
    readRef.current(handed);
  }, [location.key]);

  const save = useCallback(
    async (path: PantryCapturePath): Promise<void> => {
      setIsSaving(true);
      setSaveError(null);
      try {
        // ONE WRITE, and what it contains depends on where the rows came from:
        // a reading ADDS to the shelf, the list IS the shelf. See `nextPantry`.
        const written = await replaceLocalPantry(nextPantry({ stored, rows, path, now: Date.now() }));
        setStored(written);
        setRows(written.map((item) => draftFromStored(item, i18n.language)));
        trackPantryCaptured(path);
        // The pantry's own signal, on the ONE write this screen performs and
        // after it succeeded: the catch below is the failed save (M235/04).
        await noteActivity({ signal: 'pantry.edit', now: Date.now() });
        setPhase({ kind: 'list' });
      } catch {
        // THE ROWS STAY EXACTLY WHERE THEY ARE. A store write that failed threw
        // nothing away, so the phase is untouched and the person can press the
        // button again; a screen that silently returned to the list would look
        // like it had saved.
        setSaveError(t('pantry.errors.saveFailed'));
      } finally {
        setIsSaving(false);
      }
    },
    [rows, stored, t, i18n.language],
  );

  /** The last save's failure, or null. Rendered above whichever surface is showing. */
  const saveAlert =
    saveError === null ? null : (
      <IntakeFailureAlert subject="text" title={t('pantry.errors.title')}>
        {saveError}
      </IntakeFailureAlert>
    );

  if (effective === null) {
    return <ConnectCard logDate={null} />;
  }

  if (phase.kind === 'reading') {
    return (
      <output className="mx-auto block max-w-xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
        {t('pantry.reading')}
      </output>
    );
  }

  if (phase.kind === 'failed') {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <IntakeFailureAlert subject={phase.subject} title={t('pantry.errors.title')}>
          {phase.message}
        </IntakeFailureAlert>
        <PantryList
          rows={rows}
          onChange={setRows}
          onSave={() => void save('manual')}
          isSaving={isSaving}
          hasStoredItems={stored.length > 0}
          alert={saveAlert}
        />
      </div>
    );
  }

  if (phase.kind === 'review') {
    return (
      <PantryReview
        rows={rows}
        onChange={setRows}
        onConfirm={() => void save(phase.subject)}
        onDiscard={() => {
          setRows(stored.map((item) => draftFromStored(item, i18n.language)));
          setPhase({ kind: 'list' });
        }}
        isSaving={isSaving}
        notes={phase.notes}
        alert={saveAlert}
      />
    );
  }

  return (
    <PantryList
      rows={rows}
      onChange={setRows}
      onSave={() => void save('manual')}
      isSaving={isSaving}
      hasStoredItems={stored.length > 0}
      alert={saveAlert}
    />
  );
}
