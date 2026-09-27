/**
 * What an account page shows, in place of its form, on a page the browser
 * will not let an account ceremony run on (2026-09-27 install rehearsal).
 *
 * What is wrong, in the reader's terms (accounts need HTTPS here), what to do
 * about it (open the https address, or `localhost` on the computer that runs
 * it), and where the person who runs the server reads how. No form: a form
 * here invites an attempt that cannot work and ends in the browser's own
 * TypeError. The markup is `NeedsHttpsNotice`, shared with the OpenRouter
 * connect.
 */
import { useTranslation } from 'react-i18next';

import { NeedsHttpsNotice } from '#app/components/needs-https-notice';

export function AccountsNeedHttps() {
  const { t } = useTranslation();
  return (
    <NeedsHttpsNotice slot="accounts-need-https" title={t('secureContext.title')} body={t('secureContext.body')} />
  );
}
