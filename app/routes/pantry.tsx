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
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
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
import { buildIntakeHref } from '#app/lib/intake-hrefs';
import { takeIntakeHandoff, type ScanHandoff } from '#app/lib/intake-handoff';
import { mergePantry, pantryNameKey, type CapturedPantryItem } from '#app/lib/pantry-merge';
import { trackPantryCaptured, type PantryCapturePath } from '#app/lib/matomo-events';
import { fileToBase64 } from '#app/lib/file-to-base64';
import {
  getLocalAiSettings,
  listLocalPantryItems,
  recordLocalAiUsageEvent,
  replaceLocalPantry,
} from '#app/lib/local-store';
import type { LocalPantryItem, PantryCategory, PantryUnit } from '#app/lib/local-store';
import {
  createVisionProvider,
  PANTRY_PHOTO_TASK,
  PANTRY_TEXT_TASK,
  PANTRY_UNITS,
  VisionProviderError,
  type PantryIdentification,
  type ScanTokenUsage,
} from '#app/services/vision';
import { estimateScanCostUsd } from '#app/services/vision/cost';
import type { AiProviderType } from '#types/enums';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.pantry') }];

export const handle = {
  title: 'Pantry',
  titleKey: 'pantry.title',
  backTo: '/dashboard',
};

/** The composer's own links, so the strip on this page hands its intake back to this page. */
const PANTRY_DESCRIBE_HREF = buildIntakeHref('/describe', { to: '/pantry' });

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

/**
 * The three values `createVisionProvider` needs, out of whichever kind of
 * settings this instance resolved.
 *
 * PURE, and exported, because it is the one place a managed instance and a
 * BYOK device are collapsed into one triple, and a mistake here is a scan sent
 * to the wrong endpoint with the wrong key. `null` means this device cannot
 * call anything, which the screen renders as the connect card rather than as
 * an error: a managed instance with an upstream key but no advertised model
 * has nothing to send, and inventing a model id would fail upstream with a
 * message nobody on this side could explain.
 *
 * @param effective - what `useEffectiveAiSettings` resolved, never `null` here.
 * @returns the provider, model and base URL to call with, or `null` when there is no usable triple.
 */
export function resolveProviderTriple(
  effective: EffectiveAiSettings,
): { provider: AiProviderType; model: string; baseUrl: string | null } | null {
  if (effective.source === 'managed') {
    if (effective.model === null) return null;
    return { provider: effective.provider, model: effective.model, baseUrl: effective.baseUrl };
  }
  const { settings } = effective;
  if (settings.model === '') return null;
  // A row saved before the base-URL requirement shipped can still carry
  // `baseUrl: null` for an openai-compatible provider. Caught here rather than
  // letting `createVisionProvider`'s own guard throw, so the screen can say so.
  if (settings.provider === 'openai-compatible' && (settings.baseUrl ?? '').trim() === '') return null;
  return { provider: settings.provider, model: settings.model, baseUrl: settings.baseUrl };
}

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
  failedMessage,
}: {
  handoff: ScanHandoff;
  effective: EffectiveAiSettings;
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
      credential:
        effective.source === 'managed' ? managedAiCredential() : { apiKey: effective.settings.apiKey ?? '' },
    });
    const identification =
      handoff.kind === 'photo' ?
        await provider.runScan({
          task: PANTRY_PHOTO_TASK,
          image: { base64: await fileToBase64(handoff.file), mimeType: handoff.file.type },
        })
      : await provider.runTextIntake({ task: PANTRY_TEXT_TASK, text: handoff.text });
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
 * One line as the form holds it while a person edits.
 *
 * `amount` is a STRING, not a number, because it is the text in the box: a
 * half-typed "1." and a cleared field are both states a `number | null` cannot
 * hold, and a form that reinterpreted them mid-keystroke would delete digits
 * under the person's thumb. It becomes a number once, on confirm.
 */
export interface PantryDraftRow {
  /** Stable key for the list, never stored. A row's stored id is decided by the merge. */
  key: string;
  name: string;
  amount: string;
  unit: PantryUnit | null;
  category: PantryCategory;
}

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

/** A stored item as a draft row. */
export function draftFromStored(item: LocalPantryItem): PantryDraftRow {
  return {
    key: item.id,
    name: item.name,
    amount: item.amount === null ? '' : String(item.amount),
    unit: item.unit,
    category: item.category,
  };
}

/** A freshly read item as a draft row. */
export function draftFromReading(item: PantryIdentification['items'][number], key: string): PantryDraftRow {
  return {
    key,
    name: item.name,
    amount: item.amount === null ? '' : String(item.amount),
    unit: item.unit,
    category: item.category,
  };
}

/**
 * The draft rows as the merge wants them.
 *
 * A BLANK AMOUNT IS NULL, never 0, and an unparseable one is null too. Zero is
 * a claim ("there is none of this"), and a person who cleared the box was
 * saying they do not know. A row with no name is dropped here rather than in
 * the merge, so an "add a line" nobody filled in never reaches the store.
 *
 * @param rows - the draft rows, in the order they are shown.
 * @param source - how these rows arrived, stamped on every one of them.
 */
export function capturedFromDrafts(rows: readonly PantryDraftRow[], source: PantryCapturePath): CapturedPantryItem[] {
  const captured: CapturedPantryItem[] = [];
  for (const row of rows) {
    if (row.name.trim() === '') continue;
    const parsed = Number.parseFloat(row.amount);
    const amount = row.amount.trim() === '' || !Number.isFinite(parsed) || parsed < 0 ? null : parsed;
    captured.push({
      name: row.name,
      amount,
      unit: amount === null ? null : row.unit,
      category: row.category,
      source,
    });
  }
  return captured;
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
    <div className="space-y-2">
      {rows.map((row) => (
        <Card key={row.key}>
          <CardContent className="flex flex-wrap items-end gap-2 p-3">
            <div className="min-w-40 flex-1 space-y-1">
              <Label htmlFor={`pantry-name-${row.key}`} className="text-xs text-muted-foreground">
                {t('pantry.review.nameLabel')}
              </Label>
              <Input
                id={`pantry-name-${row.key}`}
                value={row.name}
                onChange={(event) => patch(row.key, { name: event.target.value })}
              />
            </div>
            <div className="w-20 space-y-1">
              <Label htmlFor={`pantry-amount-${row.key}`} className="text-xs text-muted-foreground">
                {t('pantry.review.amountLabel')}
              </Label>
              <Input
                id={`pantry-amount-${row.key}`}
                inputMode="decimal"
                value={row.amount}
                onChange={(event) => patch(row.key, { amount: event.target.value })}
              />
            </div>
            <div className="w-28 space-y-1">
              <Label htmlFor={`pantry-unit-${row.key}`} className="text-xs text-muted-foreground">
                {t('pantry.review.unitLabel')}
              </Label>
              <Select
                value={row.unit ?? NO_UNIT_VALUE}
                onValueChange={(value) => patch(row.key, { unit: readUnitValue(value) })}
              >
                <SelectTrigger id={`pantry-unit-${row.key}`}>
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
              aria-label={t('pantry.review.removeAria', { name: row.name })}
              onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-full"
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
}: {
  rows: readonly PantryDraftRow[];
  onChange: (rows: PantryDraftRow[]) => void;
  onSave: () => void;
  isSaving: boolean;
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
      <p className="text-sm text-muted-foreground">{hasStoredItems ? t('pantry.lead') : t('pantry.empty')}</p>
      <IntakeComposer describeTo={PANTRY_DESCRIBE_HREF} scanTo="/pantry" label={t('pantry.composerLabel')} />
      {hasStoredItems && (
        <>
          <PantryRows rows={rows} onChange={onChange} />
          <Button type="button" className="w-full" onClick={onSave} disabled={isSaving}>
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
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('pantry.recipes.link')}
        </Link>
      : <span
          aria-disabled="true"
          className="inline-flex cursor-not-allowed items-center gap-1 text-sm font-medium text-muted-foreground"
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
}: {
  rows: readonly PantryDraftRow[];
  onChange: (rows: PantryDraftRow[]) => void;
  onConfirm: () => void;
  onDiscard: () => void;
  isSaving: boolean;
  /** Anything the model said about the reading as a whole, or null. */
  notes: string | null;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t('pantry.review.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('pantry.review.lead')}</p>
      </div>
      {notes !== null && <p className="text-xs text-muted-foreground">{notes}</p>}
      <PantryRows rows={rows} onChange={onChange} />
      <div className="flex gap-2">
        <Button type="button" className="flex-1" onClick={onConfirm} disabled={isSaving}>
          {isSaving ? t('pantry.review.saving') : t('pantry.review.confirm')}
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={onDiscard} disabled={isSaving}>
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
  const { t } = useTranslation();
  const effective = useEffectiveAiSettings(loaderData.settings);
  const [stored, setStored] = useState<LocalPantryItem[]>(loaderData.items);
  const [rows, setRows] = useState<PantryDraftRow[]>(() => loaderData.items.map(draftFromStored));
  const [phase, setPhase] = useState<PantryPhase>({ kind: 'list' });
  const [isSaving, setIsSaving] = useState(false);

  // Holds the freshest reader so the mount-only hand-off effect below can run
  // it without re-subscribing every render, the same pair `/scan` uses.
  const readRef = useRef<(handoff: ScanHandoff) => void>(() => {});
  const handoffHandledRef = useRef(false);

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
        const result = await readPantry({ handoff, effective: settings, failedMessage: t('pantry.errors.failed') });
        if (!result.ok) {
          setPhase({ kind: 'failed', subject, message: result.error });
          return;
        }
        if (result.identification.items.length === 0) {
          setPhase({ kind: 'failed', subject, message: t('pantry.errors.nothingFound') });
          return;
        }
        setRows(result.identification.items.map((item, index) => draftFromReading(item, `read-${index}`)));
        setPhase({ kind: 'review', subject, notes: result.identification.notes ?? null });
      })();
    };
  });

  // THE HAND-OFF, taken once on mount. `takeIntakeHandoff` empties the slot as
  // it reads, so a remount, a StrictMode double-effect or a later visit can
  // never re-run (and re-charge for) an intake that was already handled.
  useEffect(() => {
    if (handoffHandledRef.current) return;
    handoffHandledRef.current = true;
    const handed = takeIntakeHandoff();
    if (handed === null) return;
    readRef.current(handed);
  }, []);

  const save = useCallback(
    async (path: PantryCapturePath): Promise<void> => {
      setIsSaving(true);
      try {
        const merged = mergePantry({ existing: stored, captured: capturedFromDrafts(rows, path), now: Date.now() });
        // The whole list, in one write: the rows on screen ARE the pantry
        // after this change, including the ones the person removed.
        const written = await replaceLocalPantry(merged.filter((item) => rowsHold(rows, item)));
        setStored(written);
        setRows(written.map(draftFromStored));
        trackPantryCaptured(path);
        setPhase({ kind: 'list' });
      } finally {
        setIsSaving(false);
      }
    },
    [rows, stored],
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
          setRows(stored.map(draftFromStored));
          setPhase({ kind: 'list' });
        }}
        isSaving={isSaving}
        notes={phase.notes}
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
    />
  );
}

/**
 * Whether the rows on screen still hold this merged item.
 *
 * The merge answers "what does the pantry look like after this capture", and
 * it only ever adds or updates, because a capture is not a statement about the
 * rows it did not mention. REMOVAL is the person's own act, in the form, and
 * this is where the two are reconciled: an item the merge kept from the stored
 * list but the form no longer shows was removed on purpose.
 *
 * Matching is by NAME through `pantryNameKey`, the merge's OWN folding rule
 * rather than a second spelling of it, because a row the person typed has no
 * id until the merge gives it one, and two foldings would drop rows the merge
 * had just kept.
 */
function rowsHold(rows: readonly PantryDraftRow[], item: LocalPantryItem): boolean {
  const key = pantryNameKey(item.name);
  return rows.some((row) => pantryNameKey(row.name) === key);
}
