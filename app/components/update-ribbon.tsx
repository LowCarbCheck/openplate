/**
 * One row at the top of the personal app for the whole update subject.
 *
 * ── THE TWO THINGS IT CAN SAY ───────────────────────────────────────────────
 *
 * 1. **A newer bundle is on this server.** Actionable: the assets are already
 *    being served, so "Reload" adopts them. This one wins when both are true.
 * 2. **A newer release exists on GitHub.** Informational, with a link. There is
 *    deliberately NO button: openplate is one stateless container, the server
 *    cannot upgrade itself, and a self-hoster pulls a new image while the hosted
 *    instance is deployed by an operator. A button that pretended otherwise
 *    would be a lie with a spinner on it.
 *
 * Anything else renders nothing.
 *
 * ── HOW IT SITS ─────────────────────────────────────────────────────────────
 *
 * In flow, above the header, so it RESERVES space rather than overlaying: a
 * banner that covered the app header would hide the page title and the device
 * menu at the one moment the person is being asked to do something. No `fixed`,
 * no `absolute`, no z-index.
 *
 * One line, `truncate`, and no growth between states, so the route below it does
 * not reflow under a thumb.
 *
 * ── NO COLOUR-ONLY MEANING, NO MOTION ───────────────────────────────────────
 *
 * Every state carries an icon and a sentence; the tint is decoration on top of
 * both. Nothing animates, so `prefers-reduced-motion` has nothing to suppress,
 * and the hover transition is a colour change only.
 *
 * The row is an `output` rather than a div carrying `role="status"`: it is the
 * semantic element for a live result, and it announces itself to a screen reader
 * without a redundant role attribute.
 */
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, RefreshCw, X } from 'lucide-react';

import { useUpdateStatus } from '#app/hooks/use-update-status';
import { Button } from '#app/components/ui/button';

export function UpdateRibbon() {
  const { t } = useTranslation();
  const { status, ribbon, updateNow, dismiss } = useUpdateStatus();

  if (ribbon === 'none') return null;

  if (ribbon === 'newer-bundle') {
    return (
      <output className="flex min-h-10 w-full shrink-0 items-center gap-2 border-b border-primary/20 bg-primary/10 px-4 text-sm">
        <RefreshCw className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t('chrome.update.bundleReady')}</span>
        <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" onClick={updateNow}>
          {t('chrome.update.reload')}
        </Button>
      </output>
    );
  }

  const latest = status.status?.latest ?? '';
  const releaseUrl = status.status?.releaseUrl ?? null;

  return (
    <output className="flex min-h-10 w-full shrink-0 items-center gap-2 border-b border-primary/20 bg-primary/10 px-4 text-sm">
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{t('chrome.update.releaseAvailable', { version: latest })}</span>
      {releaseUrl !== null && (
        <a
          href={releaseUrl}
          target="_blank"
          rel="noopener"
          className="shrink-0 font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('chrome.update.view')}
        </a>
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0"
        aria-label={t('chrome.update.dismiss')}
        onClick={dismiss}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </output>
  );
}
