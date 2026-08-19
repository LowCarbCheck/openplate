import type { ErrorResponse } from 'react-router';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Link } from '#app/components/link';
import { useTranslation } from 'react-i18next';
import { Button } from '#app/components/ui/button';
import { reportError } from '#app/lib/report-error';

/**
 * The subset of i18next's `t` this module needs. Declared locally so
 * `describeRouteError` stays a plain pure function with an injected translator
 * rather than reaching for the i18n singleton.
 */
/** Declared as a type alias, not an interface: i18next's `t` options take an
 *  index signature, which only an alias picks up implicitly. */
type TranslateParams = {
  /** Interpolated into `errors.statusHeading`. */
  status: number;
};
type Translate = (key: string, params?: TranslateParams) => string;

/** The two strings the fallback renders for any caught error. */
interface ErrorDescription {
  heading: string;
  details: string;
}

interface ErrorFallbackProps {
  /** The caught error — from `useRouteError()` or a boundary's `error` prop. */
  error: unknown;
  /** Where the "home" button points (defaults to the site root). */
  homeTo?: string;
  /** Label for the "home" button. Defaults to the translated "Back to home". */
  homeLabel?: string;
  /** Tag forwarded to the error reporter so dashboards can attribute the boundary. */
  boundary?: string;
}

/** Route-error responses (404s, thrown `Response`s) carry a status + statusText. */
function describeRouteError(error: ErrorResponse, t: Translate): ErrorDescription {
  // "404" is a numeral, identical in every locale — no catalog entry.
  if (error.status === 404) {
    return { heading: '404', details: t('errors.notFoundDetails') };
  }
  return {
    heading: t('errors.statusHeading', { status: error.status }),
    // `data.message`/`statusText` come off the wire in whatever language the
    // thrower used; only our own fallback is translatable here.
    details: error.data?.message || error.statusText || t('errors.loadFailed'),
  };
}

/**
 * The single error-fallback UI (DESIGN.md §2, §6) shared by every boundary —
 * root, the layout routes, and leaf routes — so the 404/error screens stop
 * drifting apart. Uses semantic tokens (works in both themes and inside the
 * root document shell) and reports anything that isn't a 404 through the
 * app-wide error reporter, tagged by `boundary`.
 */
export function ErrorFallback({ error, homeTo = '/', homeLabel, boundary = 'route' }: ErrorFallbackProps) {
  const { t } = useTranslation();
  if (!(isRouteErrorResponse(error) && error.status === 404)) {
    reportError(error, isRouteErrorResponse(error) ? { boundary, status: error.status } : { boundary });
  }
  const { heading, details } = isRouteErrorResponse(error)
    ? describeRouteError(error, t)
    : { heading: t('errors.unexpectedHeading'), details: t('errors.unexpectedDetails') };
  const devMessage = import.meta.env.DEV && error instanceof Error ? error.message : null;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">{heading}</h1>
      <p className="max-w-md text-muted-foreground">{details}</p>
      {devMessage && (
        <pre className="max-w-full overflow-auto rounded-lg bg-muted p-4 text-left text-sm text-muted-foreground">
          {devMessage}
        </pre>
      )}
      <Button asChild>
        <Link to={homeTo}>{homeLabel ?? t('errors.backToHome')}</Link>
      </Button>
    </div>
  );
}

/**
 * Leaf-route error boundary. Every personal route re-exports this as its
 * `ErrorBoundary` so a child error is caught locally (with the app chrome
 * intact) rather than bubbling to the layout boundary.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation();
  return <ErrorFallback error={error} homeTo="/diary" homeLabel={t('errors.backToDiary')} boundary="route" />;
}
