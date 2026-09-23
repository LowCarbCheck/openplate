/**
 * THE FREE WAY, first on the order page (M250/10).
 *
 * Owner, 2026-09-23: the plan choice should open with the option that costs
 * nothing, running openplate yourself. Every instance of this public app can
 * say that truthfully, so the words are app chrome (`common.json`), not the
 * biller's.
 *
 * ── INFORMATION, NOT AN OPTION ───────────────────────────────────────────
 *
 * It is not a radio and it sits OUTSIDE the plan choice's fieldset, so the
 * radio group, its arrow keys and its "pick a plan" rule never meet it, and
 * nothing on this card can be ordered. The one focus stop is the link to the
 * guide. It is drawn as a card beside the plan cards, without their ring,
 * because a ring there would promise a pick it cannot make.
 *
 * Props only, apart from `t`, so it renders in a unit test.
 */
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SELF_HOSTING_DOCS_URL } from '#app/lib/brand';

export function SelfHostCard() {
  const { t } = useTranslation();
  return (
    <div data-slot="plan-self-host" className="space-y-1 border border-border p-3">
      <p className="flex items-baseline gap-2">
        <span className="flex-1 text-sm font-medium">{t('plan.selfHost.title')}</span>
        <span data-slot="plan-self-host-price" className="text-sm font-semibold">
          {t('plan.selfHost.price')}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">{t('plan.selfHost.body')}</p>
      <p className="text-xs">
        <a
          href={SELF_HOSTING_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-slot="plan-self-host-link"
          className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
        >
          {t('plan.selfHost.link')}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
