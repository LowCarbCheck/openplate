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
 * the managed answer mirrors `/scan`'s `managed-missing` card.
 *
 * ── THE SIGNED-OUT BRANCH IS GONE (M204 spec 01) ─────────────────────────
 *
 * A third branch used to tell a signed-out visitor on a managed instance to
 * open a session again. Nobody could read it: signing out of a managed
 * instance locks the device, and the lock closes `/describe` and `/add`
 * before either one renders. The reasoning, and the lock exception that was
 * refused instead, are in `AiIntakeDoor`.
 *
 * ── THE MANAGED BRANCH IS THREE SENTENCES NOW (M212 spec 04) ─────────────
 *
 * "Ask your administrator" is true on an instance an organization runs and
 * false on a consumer instance, which has no administrator and whose real
 * reason is a date that passed. The three answers are told apart by
 * `resolveAllowanceDoor`, one module, so this notice, `/scan`'s connect card
 * and the account page cannot say three different things about one account.
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

  // NO ALLOWANCE, in whichever of the three ways is true of this account. None
  // of them carries a link, because no page fixes any of them: on an
  // organization's instance a person does, and on a consumer instance the
  // sentence stops at what is true (M212 spec 04).
  if (door.kind === 'ask-admin') {
    return <p className={NOTICE_CLASS}>{t('aiIntake.noAllowance')}</p>;
  }
  // THE DATE, not "recently" and not "in 3 days": the instant is rendered in
  // the reader's own locale, so one sentence is right in every language.
  if (door.kind === 'allowance-ended') {
    return (
      <p className={NOTICE_CLASS}>
        {t('aiIntake.allowanceEnded', { date: new Date(door.endedAt).toLocaleDateString() })}
      </p>
    );
  }
  if (door.kind === 'not-switched-on') {
    return <p className={NOTICE_CLASS}>{t('aiIntake.notSwitchedOn')}</p>;
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
