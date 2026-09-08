/**
 * WHAT A SCREEN SAYS WHEN THIS DEVICE CANNOT RUN AN AI INTAKE.
 *
 * Both ways in that write words rather than take a photograph, `/add`'s "Log
 * with AI" and `/describe`'s composer, need the same three sentences, and
 * `/scan` already had them on its connect card. One component so the three
 * screens cannot drift, and so the managed sentences are written once.
 *
 * ── THE BUG THIS EXISTS FOR (0.20.0) ─────────────────────────────────────
 *
 * Both screens used to say "connect a provider" and link to `/settings/ai`.
 * On a managed instance nobody brings a provider, and `/settings/ai` redirects
 * to `/settings`, which has no AI row: the notice pointed at a door that is
 * not there. The BYOK sentence stays exactly as it was where it is true, and
 * the two managed answers mirror `/scan`'s `managed-signed-out` and
 * `managed-missing` cards.
 *
 * The BYOK copy is a PROP because it is the one branch whose wording is the
 * screen's own: `/add` promises a whole meal in one sentence, `/describe`
 * explains why the box is dead, and each returns to its own screen after the
 * detour through settings.
 */
import { useTranslation } from 'react-i18next';
import { Link } from '#app/components/link';
import type { AiIntakeDoor } from '#app/components/add/use-ai-connection';

interface NoAiIntakeNoticeProps {
  door: AiIntakeDoor;
  /** The BYOK branch's own sentence, as a translated string. */
  byokMessage: string;
  /** The BYOK branch's link text. */
  byokLinkLabel: string;
  /** Where that link goes, carrying its own return. */
  byokHref: string;
}

const NOTICE_CLASS = 'text-xs text-muted-foreground';
const LINK_CLASS = 'text-primary underline-offset-4 hover:underline';

export function NoAiIntakeNotice({ door, byokMessage, byokLinkLabel, byokHref }: NoAiIntakeNoticeProps) {
  const { t } = useTranslation();

  // NO SESSION on an instance whose AI comes with one. The door is sign-in and
  // nothing about the account has to change, so no administrator is named.
  if (door === 'sign-in') {
    return (
      <p className={NOTICE_CLASS}>
        {t('aiIntake.signedOut')}{' '}
        <Link to="/sign-in" className={LINK_CLASS}>
          {t('aiIntake.signIn')}
        </Link>
      </p>
    );
  }

  // SIGNED IN, NO ALLOWANCE, which is what a new account looks like until an
  // administrator raises it. There is no link because there is no page that
  // fixes it.
  if (door === 'ask-admin') {
    return <p className={NOTICE_CLASS}>{t('aiIntake.noAllowance')}</p>;
  }

  return (
    <p className={NOTICE_CLASS}>
      {byokMessage}{' '}
      <Link to={byokHref} className={LINK_CLASS}>
        {byokLinkLabel}
      </Link>
    </p>
  );
}
