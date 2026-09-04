/**
 * What `/admin` shows to everybody who is not an administrator of this
 * instance.
 *
 * ── One card for three different people ──────────────────────────────────
 *
 * A signed-out visitor, somebody with an ordinary account, and an
 * administrator who has just been demoted or suspended all land here. They are
 * told the same thing, because telling them apart would answer a question a
 * stranger should not get an answer to: whether the address they are signed in
 * as has administrative rights on this instance.
 *
 * ── It says what to do, not what went wrong ──────────────────────────────
 *
 * "Forbidden" is a fact about a request. The person reading this wants their
 * allowance raised or their password reset, and the only useful sentence is
 * the one that points at the human who can do it.
 */
import { useTranslation } from 'react-i18next';
import { ShieldOff } from 'lucide-react';

import { Link } from '#app/components/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';

export function NotAnAdministratorCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          {t('admin.notAdmin.title')}
        </CardTitle>
        <CardDescription>{t('admin.notAdmin.body')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link to="/settings" className="text-sm text-primary underline-offset-4 hover:underline">
          {t('admin.notAdmin.back')}
        </Link>
      </CardContent>
    </Card>
  );
}
