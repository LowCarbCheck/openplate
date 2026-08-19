import { Outlet, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';
import PublicWrapper from '#app/components/public-wrapper';
import { ErrorFallback } from '#app/components/route-error-boundary';

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
