/**
 * THE ONE WAY A CLOSED FEATURE IS SHOWN (M2/05, ADR-0024).
 *
 * Every gate site in the app draws a closed feature the same way: the entry
 * point that would START the feature is replaced by a short note with a small
 * lock mark. The note names the feature, says that what the person recorded
 * stays theirs, and links to the plan page. It never navigates into the
 * feature's create flow, and it never hides the feature: a person has to be
 * able to find what they could buy.
 *
 * ── A DOOR, NOT A LOCK ───────────────────────────────────────────────────
 *
 * The client decides nothing that costs money. `isOpen` comes from
 * `useFeatureGate`, which fails open (no plans door, no capability list, the
 * account view not read yet, a person on their own AI key). The core's AI proxy
 * is the lock, and its `403 capability-required` is shown with this same note.
 *
 * ── NOTHING MOVES ────────────────────────────────────────────────────────
 *
 * The answer is held from the first paint (`useFeatureGate`), so a screen draws
 * the open form or the note and never turns one into the other. The note is a
 * static, square block: no animation, no late line.
 *
 * ── NO TIER NAME, NO PRICE ───────────────────────────────────────────────
 *
 * The words are about the feature ("Pantry scan is not included in your
 * plan"). What a tier is called and what it costs is on the plan page, drawn
 * from the biller's own answer.
 *
 * Props only, apart from `t`, so every state renders in a unit test.
 */
import type { ReactElement, ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';
import type { FeatureLabel } from '#app/lib/plans/capabilities';
import { PLAN_PAGE_HREF } from '#app/lib/plans/plans-door';
import { cn } from '#app/lib/utils';

/** The catalog key of each feature's name. A `Record`, so a fifth feature fails to compile here. */
const FEATURE_NAME_KEY = {
  fasting: 'featureGate.names.fasting',
  pantry: 'featureGate.names.pantry',
  voice: 'featureGate.names.voice',
  chat: 'featureGate.names.chat',
} satisfies Record<FeatureLabel, string>;

/** The name of a feature in the reader's language, for the note and for the plan page's feature list. */
export function featureNameKey(feature: FeatureLabel): string {
  return FEATURE_NAME_KEY[feature];
}

/**
 * The closed-feature note.
 *
 * @param props.feature - the feature that is closed.
 * @param props.hasPlansLink - `true` draws the link to the plan page. Always
 *   true where the client itself closed the door (a plans door exists by
 *   definition); the proxy's refusal passes what the handshake says, because a
 *   self-hosted core can refuse a feature with no biller behind it.
 * @param props.className - layout only, from the screen that places it.
 */
export function ClosedFeatureNote({
  feature,
  hasPlansLink = true,
  className,
}: {
  feature: FeatureLabel;
  hasPlansLink?: boolean;
  className?: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <section
      data-slot="closed-feature"
      data-feature={feature}
      aria-labelledby={`closed-feature-${feature}`}
      className={cn('space-y-2 border bg-card p-4', className)}
    >
      <h2 id={`closed-feature-${feature}`} className="flex items-center gap-2 text-sm font-semibold">
        <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {t('featureGate.closed.title', { feature: t(FEATURE_NAME_KEY[feature]) })}
      </h2>
      <p className="text-sm text-muted-foreground">{t('featureGate.closed.body')}</p>
      {hasPlansLink && (
        <Link
          to={PLAN_PAGE_HREF}
          data-slot="closed-feature-plans"
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 sm:min-h-9"
        >
          {t('featureGate.closed.plans')}
        </Link>
      )}
    </section>
  );
}

/**
 * The entry point of a feature, or the note that says it is closed.
 *
 * @param props.feature - the feature word.
 * @param props.isOpen - from `useFeatureGate`. `true` draws `children` exactly
 *   as the screen drew them before there were gates.
 * @param props.children - the open form of the entry point.
 * @param props.className - layout of the note only.
 */
export function FeatureGate({
  feature,
  isOpen,
  children,
  className,
}: {
  feature: FeatureLabel;
  isOpen: boolean;
  children: ReactNode;
  className?: string;
}): ReactElement {
  if (isOpen) return <>{children}</>;
  return <ClosedFeatureNote feature={feature} className={className} />;
}
