/**
 * `/dev/playground` — a temporary review page, not shipped UI.
 *
 * It renders candidate looks for two components side by side, at a phone width,
 * on the ordinary app background, so a person can pick one in a browser without
 * a logged-in device and without real data. Nothing on this page is wired into
 * the dashboard or the diary.
 *
 * DEV ONLY. The `clientLoader` answers 404 in a production build, so the address
 * exists only while `pnpm dev` is running. It is top-level and client-only: it
 * depends on no layout loader and no onboarding gate, and there is nothing here
 * for a server loader to do.
 *
 * The forms are REAL. Each "Wie gestern" variant posts the same intent the
 * shipped door posts, so the wrapper below swallows the submit in the capture
 * phase: a review page must not copy a day into somebody's diary.
 */
import type { FormEvent, ReactElement, ReactNode } from 'react';

import { AddFoodActionsSegmented } from '#app/components/playground/add-food-actions-variants';
import { RepeatYesterdayEyebrow } from '#app/components/playground/repeat-yesterday-variants';
import { IntakeComposer } from '#app/components/intake/intake-composer';
import { RepeatYesterdayDoor, RepeatYesterdayGhost } from '#app/components/repeat-yesterday-door';
import type { RepeatYesterdayOffer } from '#app/lib/copy-day';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Card, CardContent } from '#app/components/ui/card';

export function clientLoader(): null {
  if (!import.meta.env.DEV) throw new Response('Not Found', { status: 404 });
  return null;
}

export function HydrateFallback(): ReactElement {
  return <div className="min-h-screen bg-background" />;
}

const SAMPLE_OFFER: RepeatYesterdayOffer = {
  sourceDate: '2026-09-13',
  targetDate: '2026-09-14',
  sourceCount: 3,
  targetCount: 0,
};

function Sample({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
      <div className="rounded-lg border border-border bg-card/40 p-4">
        <div className="mx-auto max-w-sm">{children}</div>
      </div>
    </section>
  );
}

const swallowSubmit = (event: FormEvent<HTMLDivElement>) => event.preventDefault();

export default function DevPlayground(): ReactElement {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-2">
          <p className="inline-flex rounded-full bg-accent-amber-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent-amber">
            Temporary review page, not shipped UI
          </p>
          <h1 className="text-2xl font-bold">Component variants</h1>
          <p className="text-sm text-muted-foreground">
            Pick one per group. Labels and counts come from the real translations; the forms here do not submit.
          </p>
        </header>

        {/*
          The operator's pick, staged together: C above A, inside the same card
          shape, padding and stacking order as `TodayHeroCard`'s action column
          in `app/routes/dashboard.tsx`, so this reads as a preview of the
          combined today-card rather than two boxes shown side by side. The
          form swallow below matches the "Repeat yesterday" section further
          down: `RepeatYesterdayGhost` posts the same real `copy-yesterday`
          intent, and a review page must not copy a day into anyone's diary.
        */}
        <div className="space-y-6" onSubmitCapture={swallowSubmit}>
          <h2 className="text-lg font-semibold">Staged for review: A + C combined</h2>
          <p className="text-sm text-muted-foreground">
            Concept C (ghost of yesterday) stacked above concept A (composer strip), inside the real hero card shell.
          </p>
          <div className="mx-auto max-w-sm">
            <Card className="surface-brand overflow-hidden rounded-2xl shadow-sm">
              <CardContent className="space-y-3 p-5 sm:p-6">
                <RepeatYesterdayGhost offer={SAMPLE_OFFER} />
                <IntakeComposer describeTo="/describe" />
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Add an entry</h2>
          <Sample label="A. Composer strip, write here, camera and mic in the frame">
            <IntakeComposer describeTo="/describe" />
          </Sample>
          <Sample label="B. Segmented control, one surface split by hairlines">
            <AddFoodActionsSegmented describeTo="/describe" />
          </Sample>
        </div>

        <div className="space-y-6" onSubmitCapture={swallowSubmit}>
          <h2 className="text-lg font-semibold">Repeat yesterday</h2>
          <Sample label="Today: dashed outline pill">
            <RepeatYesterdayDoor offer={SAMPLE_OFFER} />
          </Sample>
          <Sample label="C. Ghost of yesterday, a card that draws what it would bring over">
            <RepeatYesterdayGhost offer={SAMPLE_OFFER} />
          </Sample>
          {/* Shown with the add row under it: the eyebrow is a heading line for
              what follows, so it cannot be judged floating on its own. */}
          <Sample label="D. Eyebrow line above the add row">
            <div className="space-y-3">
              <RepeatYesterdayEyebrow offer={SAMPLE_OFFER} />
              <IntakeComposer describeTo="/describe" />
            </div>
          </Sample>
        </div>
      </div>
    </main>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
