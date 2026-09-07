/**
 * The answer to "what can my administrator see about me", on the page where a
 * person asks it (M201 spec 06).
 *
 * ── Why here and not only in the privacy policy ──────────────────────────
 *
 * The privacy page says it too, and has to: it is the legally operative
 * document. But a study participant reading a legal page is doing legal
 * reading, and somebody looking at their own account is asking a direct
 * question about themselves. The two answers state the same facts and are
 * deliberately not the same sentences: this one is the app's register, second
 * person and short, and `legal/privacy.tsx` is the operator's.
 *
 * ── The list is not written here ─────────────────────────────────────────
 *
 * Every line comes from `OPERATOR_VISIBLE_LINES`, which is derived from a
 * table over `AdminAccountView` itself. So a field the admin API exposes
 * cannot be missing from this card without failing the gate, and a line on
 * this card cannot describe a field that no longer exists. That coupling is
 * the whole point of the spec; the component only draws what the table says.
 *
 * ── What the last paragraph does and does not claim ──────────────────────
 *
 * It says the diary cannot be read on the ADMINISTRATION pages, which is what
 * `admin/person-detail.tsx` tells the operator on the other side of the same
 * screen. It does not say the operator can never read a diary, because on a
 * managed instance that would be false: the recovery key is escrowed so that a
 * forgotten password gives somebody their data back, and the privacy policy
 * says so in the section this app deliberately does not try to summarise here.
 *
 * ── Presentational, and router-free ──────────────────────────────────────
 *
 * No hook but `useTranslation`, and no `Link`, so a unit test can render it
 * with the real English catalog and no data router. The gate that decides
 * whether it appears at all is `operatorSeesActivity`, and it lives at the one
 * call site in `settings.account.tsx`.
 */
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { OPERATOR_VISIBLE_LINES, USAGE_COUNTER_RETENTION_DAYS } from '#app/lib/admin/operator-visibility';

export function OperatorVisibilityCard() {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-primary" aria-hidden="true" /> {t('account.operatorSees.title')}
        </CardTitle>
        <CardDescription>{t('account.operatorSees.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {OPERATOR_VISIBLE_LINES.map((line) => (
            <li key={line.field}>{t(line.copyKey)}</li>
          ))}
        </ul>
        <p className="text-sm">{t('account.operatorSees.activity', { days: USAGE_COUNTER_RETENTION_DAYS })}</p>
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          {t('account.operatorSees.notTheDiary')}
        </p>
      </CardContent>
    </Card>
  );
}
