import type { MetaFunction } from 'react-router';
import { Outlet, isRouteErrorResponse, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';
import PublicWrapper from '#app/components/public-wrapper';
import { ErrorFallback } from '#app/components/route-error-boundary';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

/**
 * The layout's own `<title>`, which in practice is the ERROR title.
 *
 * Every child of this layout exports its own `meta`, and a leaf's meta
 * replaces its parent's — so this one is never what a working page renders.
 * It surfaces on exactly one path: when a child throws, React Router truncates
 * the match list at the route that owns the boundary (this one) and asks it
 * for the head. Without this export that head carried an empty `<title>`,
 * which is what a `/nope-404` used to serve.
 */
export const meta: MetaFunction = ({ matches, error }) => [
  {
    title: metaTitle(
      metaLanguage(matches),
      isRouteErrorResponse(error) && error.status === 404 ? 'meta.notFound' : 'meta.error',
    ),
  },
];

export default function PublicLayout() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const { t } = useTranslation();
  const error = useRouteError();
  return (
    <PublicWrapper>
      <ErrorFallback error={error} homeTo="/" homeLabel={t('errors.backToHome')} boundary="public-layout" />
    </PublicWrapper>
  );
}
