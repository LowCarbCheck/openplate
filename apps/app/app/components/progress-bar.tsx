import { useEffect, useState } from 'react';
import { useNavigation, useFetchers } from 'react-router';
import { cn } from '#app/lib/utils';

/**
 * How long the app has to stay busy before the bar appears.
 *
 * Nearly every client-side navigation in this app reads IndexedDB and settles
 * in a handful of milliseconds; showing the bar for those means a teal streak
 * flickers across the top of the screen on every single tap, which reads as
 * jank rather than as feedback. Waiting a beat means the bar only ever appears
 * for waits a person can actually perceive — and for the ones that matter (the
 * AI vision POST, a cold route chunk) 150ms is imperceptible next to the wait
 * it is announcing.
 */
const SHOW_DELAY_MS = 150;

/**
 * Global top progress bar (DESIGN.md §7). Runs during any non-idle navigation
 * OR any non-idle fetcher — the latter matters because slow action POSTs (the
 * AI vision call) sit in `submitting`, not `loading`.
 *
 * Derived straight from the router's own state: no context provider, no
 * imperative start/stop, nothing for a caller to forget to call.
 *
 * Appearance is delayed (above) but disappearance is not — once the work is
 * done the bar fades out immediately, because a progress indicator that
 * outlives its work is a lie.
 */
export function ProgressBar() {
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const isBusy = navigation.state !== 'idle' || fetchers.some((fetcher) => fetcher.state !== 'idle');
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!isBusy) {
      setIsVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setIsVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isBusy]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1">
      <div
        className={cn(
          'h-full w-full overflow-hidden bg-primary/20 transition-opacity duration-200',
          isVisible ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="h-full w-1/3 bg-primary animate-indeterminate" />
      </div>
    </div>
  );
}
