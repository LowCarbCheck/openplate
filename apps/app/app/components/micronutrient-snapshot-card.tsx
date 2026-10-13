/**
 * Vitamins and minerals, at a glance: the block under "What you ate" on the
 * diary and on Insights' Nutrition tab, with a link into `/nutrients`.
 *
 * PRESENTATIONAL. Every fact arrives in props: the snapshot
 * (`#app/lib/micronutrient-snapshot`, built from the real rows), the deep link,
 * the window it describes, and whether the reference amounts are still on their
 * way. `MicronutrientSnapshotBlock` does the reading; the states playground
 * mounts this with fixture snapshots built through the same pipeline.
 *
 * ── THE RULES OF `/nutrients`, UNCHANGED ──────────────────────────────────
 *
 * - The copy describes the LOG, never the body, and there is no supplement
 *   anywhere in it.
 * - No number below the coverage bar. `not-enough-data` shows no amount, no
 *   percent of a reference and no bar; the one percent it may show is the share
 *   of logged food that carried figures, a fact about the data.
 * - A limit uses limit words and never a percent, and it is never a gap.
 * - A gap's bar is neutral at every share. Colouring the low end would turn a
 *   data gap into a verdict about the person (DESIGN.md section 10.1), and the
 *   brand colour is counted per screen (section 6).
 *
 * ── NO LAYOUT SHIFT WHILE THE REFERENCES LOAD ────────────────────────────
 *
 * The count is known from the log at once; the gaps need the reference list,
 * which arrives later from the network. So the part under the count is ONE
 * grid cell holding every answer it can give as a layer: the loading line, the
 * gap list, and each sentence that explains why there are no gaps. Exactly one
 * layer is visible, the rest are `invisible`, `inert` and `aria-hidden`, and a
 * reserve layer that is never shown holds the tallest gap list there can be
 * (three rows with the longest nutrient name in this language, and the limit
 * row). The cell is as tall as its tallest layer from the first paint, so the
 * answer arriving moves nothing (DESIGN.md section 7, the recipe
 * `ReproductiveStatusFields` uses for onboarding). The one answer that skips
 * the reserve is "add your details": it is known from the log and the saved
 * profile at the first paint, so nothing arrives after it.
 *
 * The reserve counts ONE limit row because sodium is the only ceiling upstream
 * publishes. A second ceiling over its limit would grow the cell when it lands.
 */
import { useId, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import {
  CHIP_NEUTRAL,
  DATA_ROW_CLASS,
  DATA_ROW_LABEL_CLASS,
  DATA_ROW_VALUE_CLASS,
} from '#app/components/list-row';
import { SectionEyebrow } from '#app/components/typography';
import { DEFAULT_MIN_COVERAGE_FRACTION } from '#app/lib/local-store';
import { SNAPSHOT_GAP_LIMIT } from '#app/lib/micronutrient-snapshot';
import type {
  MicronutrientSnapshot,
  NotEnoughDataSnapshot,
  ReadySnapshot,
  SnapshotGap,
  SnapshotOverLimit,
} from '#app/lib/micronutrient-snapshot';
import { DISPLAYED_NUTRIENT_KEYS, formatSharePercent, SUGGESTION_SHARE_CEILING } from '#app/lib/nutrient-reference';
import type { NutrientRange } from '#app/lib/nutrient-window';
import { cn } from '#app/lib/utils';

/** The days the block describes: the diary's one day, or Insights' window. */
export type SnapshotScope = { kind: 'day' } | { kind: 'range'; days: NutrientRange };

export interface MicronutrientSnapshotCardProps {
  snapshot: MicronutrientSnapshot;
  /** The deep link into `/nutrients` for the same days. */
  to: string;
  scope: SnapshotScope;
  /** True while the reference amounts are still loading, so the gaps are not known yet. */
  isLoading: boolean;
}

/** Which answer the cell under the count shows. */
type DetailLayer = 'loading' | 'gaps' | 'no-gaps' | 'no-body-metrics' | 'unreachable' | 'age-out-of-bands';

/** The cell's answer for a ready snapshot. */
function detailLayerOf({ snapshot, isLoading }: { snapshot: ReadySnapshot; isLoading: boolean }): DetailLayer {
  if (isLoading) return 'loading';
  if (snapshot.references !== 'available') return snapshot.references;
  return snapshot.gaps.length > 0 ? 'gaps' : 'no-gaps';
}

/**
 * One layer of the cell. Shown, or held in place unseen, unreachable and silent.
 *
 * @param isShown - whether this is the layer on screen.
 */
function Layer({ isShown, children }: { isShown: boolean; children: ReactNode }): ReactElement {
  return (
    <div
      className={cn('min-w-0', !isShown && 'invisible')}
      aria-hidden={isShown ? undefined : true}
      inert={!isShown}
      data-layer-shown={isShown ? 'true' : undefined}
    >
      {children}
    </div>
  );
}

/**
 * A row of the gap list: the nutrient, a neutral bar of its share, and the
 * share as a percent. The name wraps rather than clips (the M243 clip sweep).
 */
function GapRow({ label, share }: { label: string; share: number }): ReactElement {
  const { i18n: i18next } = useTranslation();
  return (
    <div data-slot="micronutrient-gap" className={cn(DATA_ROW_CLASS, 'gap-3 px-3 py-2')}>
      <dt className={cn(DATA_ROW_LABEL_CLASS, 'min-w-0 flex-1 break-words')}>{label}</dt>
      {/* `bg-muted-foreground` at every share: a ratio to a published amount,
          never a grade. A gap is below the suggestion ceiling by construction,
          so the width never needs a clamp. */}
      <div className="h-1.5 w-14 shrink-0 bg-muted" aria-hidden="true">
        <div className="h-full bg-muted-foreground" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <dd className={cn(DATA_ROW_VALUE_CLASS, 'ml-0 w-11 shrink-0 text-right')}>
        {formatSharePercent(share, { language: i18next.language })}
      </dd>
    </div>
  );
}

/** A limit the log went over: the nutrient, its limit badge, and the words, never a percent. */
function OverLimitRow({ label }: { label: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <div data-slot="micronutrient-over-limit" className={cn(DATA_ROW_CLASS, 'gap-2 px-3 py-2')}>
      <dt className={cn(DATA_ROW_LABEL_CLASS, 'flex min-w-0 flex-1 flex-wrap items-center gap-1.5 break-words')}>
        {label}
        <span className={cn(CHIP_NEUTRAL, 'px-1.5 py-0 text-xs font-medium')}>{t('nutrients.limit.badge')}</span>
      </dt>
      <dd className={cn(DATA_ROW_VALUE_CLASS, 'ml-0 shrink-0')}>{t('nutrients.snapshot.overLimit')}</dd>
    </div>
  );
}

/** The gap list's lead line, which says what the shares are of. */
function GapsLead({ scope }: { scope: SnapshotScope }): ReactElement {
  const { t } = useTranslation();
  return (
    <p className="text-xs text-muted-foreground">
      {scope.kind === 'day' ? t('nutrients.snapshot.gapsLeadDay') : t('nutrients.snapshot.gapsLeadRange')}
    </p>
  );
}

/** The gaps, then the limits the log went over. */
function GapList({
  gaps,
  overLimits,
  scope,
}: {
  gaps: readonly SnapshotGap[];
  overLimits: readonly SnapshotOverLimit[];
  scope: SnapshotScope;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <GapsLead scope={scope} />
      <dl className="space-y-1">
        {gaps.map((gap) => (
          <GapRow key={gap.key} label={t(`nutrients.name.${gap.key}`)} share={gap.share} />
        ))}
        {overLimits.map((limit) => (
          <OverLimitRow key={limit.key} label={t(`nutrients.name.${limit.key}`)} />
        ))}
      </dl>
    </div>
  );
}

/**
 * The tallest gap list there can be, never shown: the lead, three rows named
 * with the longest nutrient name in this language, and one limit row.
 */
function ReserveList({ scope }: { scope: SnapshotScope }): ReactElement {
  const { t } = useTranslation();
  const names = DISPLAYED_NUTRIENT_KEYS.map((key) => t(`nutrients.name.${key}`));
  const longest = names.reduce((left, right) => (right.length > left.length ? right : left), '');
  return (
    <div className="space-y-2">
      <GapsLead scope={scope} />
      <dl className="space-y-1">
        {Array.from({ length: SNAPSHOT_GAP_LIMIT }, (_, index) => (
          <GapRow key={index} label={longest} share={0} />
        ))}
        <OverLimitRow label={longest} />
      </dl>
    </div>
  );
}

/** The loading answer: what is on its way, over the rows it will fill. */
function LoadingList(): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('nutrients.snapshot.loading')}</p>
      <div className="space-y-1" aria-hidden="true">
        {Array.from({ length: SNAPSHOT_GAP_LIMIT }, (_, index) => (
          <div key={index} className={cn(DATA_ROW_CLASS, 'h-9 px-3 py-2 motion-safe:animate-pulse')} />
        ))}
      </div>
    </div>
  );
}

/** One sentence that says why there are no gaps, and an optional way to fix it. */
function Reason({ children }: { children: ReactNode }): ReactElement {
  return <div className="space-y-1 text-xs text-muted-foreground">{children}</div>;
}

/** The ready block: the count, then the one cell that holds every answer under it. */
function ReadyBody({
  snapshot,
  scope,
  isLoading,
}: {
  snapshot: ReadySnapshot;
  scope: SnapshotScope;
  isLoading: boolean;
}): ReactElement {
  const { t, i18n: i18next } = useTranslation();
  const shown = detailLayerOf({ snapshot, isLoading });
  return (
    <>
      <p className="text-sm font-medium tabular-nums">
        {t('nutrients.hero.covered', { covered: snapshot.coveredCount, total: snapshot.totalCount })}
      </p>
      <div data-slot="micronutrient-snapshot-detail" data-layer={shown} className="grid *:col-start-1 *:row-start-1">
        {/* Without body metrics the answer is known from the first paint and
            never changes into a list, so it holds no list-sized box open. */}
        {snapshot.references !== 'no-body-metrics' && (
          <Layer isShown={false}>
            <ReserveList scope={scope} />
          </Layer>
        )}
        <Layer isShown={shown === 'loading'}>
          <LoadingList />
        </Layer>
        <Layer isShown={shown === 'gaps'}>
          <GapList gaps={snapshot.gaps} overLimits={snapshot.overLimits} scope={scope} />
        </Layer>
        <Layer isShown={shown === 'no-gaps'}>
          <div className="space-y-2">
            <Reason>
              <p>
                {t('nutrients.snapshot.noGaps', {
                  share: formatSharePercent(SUGGESTION_SHARE_CEILING, { language: i18next.language }),
                })}
              </p>
            </Reason>
            {snapshot.overLimits.length > 0 && (
              <dl className="space-y-1">
                {snapshot.overLimits.map((limit) => (
                  <OverLimitRow key={limit.key} label={t(`nutrients.name.${limit.key}`)} />
                ))}
              </dl>
            )}
          </div>
        </Layer>
        <Layer isShown={shown === 'no-body-metrics'}>
          <Reason>
            <p>{t('nutrients.snapshot.noBodyMetrics')}</p>
            <Link
              to="/settings/profile"
              className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('nutrients.reference.noBodyMetricsAction')}
            </Link>
          </Reason>
        </Layer>
        <Layer isShown={shown === 'unreachable'}>
          <Reason>
            <p>{t('nutrients.snapshot.unreachable')}</p>
          </Reason>
        </Layer>
        <Layer isShown={shown === 'age-out-of-bands'}>
          <Reason>
            <p>{t('nutrients.reference.ageOutOfBands')}</p>
          </Reason>
        </Layer>
      </div>
    </>
  );
}

/**
 * The not-enough-data block. It says how much of the logged food carried
 * figures, by weight, and never an intake: below the bar there is none.
 */
function NotEnoughDataBody({ snapshot }: { snapshot: NotEnoughDataSnapshot }): ReactElement {
  const { t, i18n: i18next } = useTranslation();
  const language = i18next.language;
  const coverage = formatSharePercent(snapshot.bestCoveredFraction, { language });
  // A share that rounds to "0%" is said in words: "0% of the food carries
  // figures" is a number standing in for "none".
  const hasAnyCoverage = coverage !== formatSharePercent(0, { language });
  return (
    <>
      <p className="text-sm font-medium">{t('nutrients.coverage.notEnoughData')}</p>
      <p className="text-xs text-muted-foreground">
        {hasAnyCoverage ?
          t('nutrients.snapshot.coveragePartial', {
            share: coverage,
            bar: formatSharePercent(DEFAULT_MIN_COVERAGE_FRACTION, { language }),
          })
        : t('nutrients.snapshot.coverageNone')}
      </p>
    </>
  );
}

/**
 * @param props - see {@link MicronutrientSnapshotCardProps}.
 */
export function MicronutrientSnapshotCard({ snapshot, to, scope, isLoading }: MicronutrientSnapshotCardProps): ReactElement {
  const { t } = useTranslation();
  const headingId = useId();
  // Only a ready block has an answer that waits on the reference list: the
  // empty and not-enough-data answers come from the log alone.
  const isWaiting = isLoading && snapshot.kind === 'ready';
  return (
    <section
      data-slot="micronutrient-snapshot"
      data-state={snapshot.kind}
      data-loading={isWaiting ? 'true' : undefined}
      aria-labelledby={headingId}
      aria-busy={isWaiting}
      className="space-y-3"
    >
      <SectionEyebrow as="h4" id={headingId}>
        {t('nutrients.snapshot.title')}
      </SectionEyebrow>
      {snapshot.kind === 'empty' && <p className="text-sm text-muted-foreground">{t('nutrients.hero.empty')}</p>}
      {snapshot.kind === 'not-enough-data' && <NotEnoughDataBody snapshot={snapshot} />}
      {snapshot.kind === 'ready' && <ReadyBody snapshot={snapshot} scope={scope} isLoading={isLoading} />}
      <Link
        to={to}
        data-slot="micronutrient-snapshot-link"
        className="inline-flex min-h-11 items-center text-xs text-primary underline-offset-4 hover:underline"
      >
        {scope.kind === 'day' ?
          t('nutrients.snapshot.linkDay')
        : t('nutrients.snapshot.linkRange', { days: scope.days })}
      </Link>
    </section>
  );
}
