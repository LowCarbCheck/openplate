import { Download, Share } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { APP_NAME } from '#app/lib/brand';
import { useInstallAffordance } from '#app/hooks/use-install-affordance';
import type { InstallAffordanceControls } from '#app/hooks/use-install-affordance';

/**
 * The one place the prompt-vs-iOS branching is written. Takes the hook's own
 * return shape as props rather than calling `useInstallAffordance` itself, so
 * every surface that renders it (the settings hub's `InstallCard` below, and
 * the onboarding wizard's first-food lesson, `routes/onboarding.tsx`) reads
 * the hook exactly once and only supplies its own layout around this.
 *
 * Renders nothing for the two states that have no action to offer,
 * `'already-installed'` and `'cannot-install'`. This body is affordances only:
 * the plain "it installs on a phone" sentence a `'cannot-install'` browser
 * gets in onboarding is information, not something to press, so it belongs to
 * the surface that chooses to teach it (`FirstFoodInstallFootnote`) rather
 * than here, where every caller renders it.
 *
 * `type="button"` is explicit because a caller may render this inside a
 * `<form>` (the onboarding step does); without it a native `<button>` inside
 * a form defaults to `type="submit"` and would submit the enclosing form.
 */
export function InstallAffordanceAction({ affordance, promptInstall }: InstallAffordanceControls) {
  const { t } = useTranslation();

  if (affordance === 'prompt') {
    return (
      <Button
        type="button"
        onClick={() => void promptInstall()}
        className="h-11 w-full justify-center sm:h-10 sm:w-auto"
      >
        <Download />
        {t('install.action', { appName: APP_NAME })}
      </Button>
    );
  }

  if (affordance === 'ios-instructions') {
    return (
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <Share className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          {/* Two emphasised fragments name literal Safari UI, so they must
              travel with the sentence rather than be spliced around it. */}
          <Trans
            i18nKey="install.iosInstructions"
            components={{
              share: <span className="font-medium text-foreground" />,
              addToHome: <span className="font-medium text-foreground" />,
            }}
          />
        </p>
      </div>
    );
  }

  return null;
}

/**
 * Quiet "Install openplate" affordance at the bottom of the settings hub
 * (`routes/settings._index.tsx`). The `beforeinstallprompt` capture and
 * platform detection both live in `useInstallAffordance` (shared with the
 * app-chrome nav drawer's "Install app" item, `app-wrapper.tsx`) — this
 * component is just its shell around `InstallAffordanceAction`.
 */
export function InstallCard() {
  const { affordance, promptInstall } = useInstallAffordance();
  const { t } = useTranslation();

  // Both silent states render nothing HERE, for two different reasons, and
  // the split in `InstallAffordance` is what lets this card say so rather
  // than guess. Already installed: nothing left to say. Cannot install: the
  // settings hub is a list of things you can do on this device, and a card
  // headed "Install openplate" whose body is a sentence about some other
  // device is a control that isn't one. The onboarding lesson takes that
  // sentence instead, because a lesson is where a fact belongs; a reader who
  // opened settings came looking for a switch, not for teaching.
  if (affordance === 'already-installed' || affordance === 'cannot-install') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" /> {t('install.title', { appName: APP_NAME })}
        </CardTitle>
        <CardDescription>{t('install.description', { appName: APP_NAME })}</CardDescription>
      </CardHeader>
      <CardContent>
        <InstallAffordanceAction affordance={affordance} promptInstall={promptInstall} />
      </CardContent>
    </Card>
  );
}
