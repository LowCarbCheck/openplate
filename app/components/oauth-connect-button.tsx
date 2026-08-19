import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#app/components/ui/alert-dialog';
import { Button, buttonVariants } from '#app/components/ui/button';
import type { VariantProps } from 'class-variance-authority';
import { beginConnect, OPENROUTER_OAUTH_CONFIG } from '#app/lib/oauth-pkce';
import { reportError } from '#app/lib/report-error';

interface OAuthConnectButtonProps {
  className?: string;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  /** Trigger button label — callers may pass their own copy (defaults to the translated "Connect with OpenRouter"). */
  children?: ReactNode;
}

/**
 * "Connect with OpenRouter" entry point (M127/02), shared by AI settings and
 * the scan-page empty state so the pre-redirect expectation screen and the
 * PKCE kickoff live in exactly one place. Always shows the plain-language
 * expectation dialog before leaving the app; `beginConnect` only runs once
 * the user confirms — a cancel never touches storage or navigates anywhere.
 *
 * This is the ONLY provider today with an OAuth PKCE flow
 * (`#app/services/vision/registry`), so this component itself
 * stays OpenRouter-specific; a second OAuth-capable provider would get its
 * own button reading the same capability table, not a branch added here.
 */
export function OAuthConnectButton({ className, variant = 'default', children }: OAuthConnectButtonProps) {
  // The label default lives here, not in the parameter list: a default value
  // can't call a hook, and a caller-supplied `children` still wins.
  const { t } = useTranslation();
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    setIsStarting(true);
    setStartError(null);
    try {
      const { redirectUrl } = await beginConnect(OPENROUTER_OAUTH_CONFIG);
      window.location.href = redirectUrl;
    } catch (error) {
      reportError(error, { boundary: 'oauth-connect-button' });
      setStartError(t('oauth.connect.startFailed'));
      setIsStarting(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={variant} className={className}>
          {children ?? t('oauth.connect.button')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('oauth.connect.dialogTitle')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left text-sm text-muted-foreground">
              <p>{t('oauth.connect.leaveNote')}</p>
              <p>{t('oauth.connect.spendingCap')}</p>
              <p>{t('oauth.connect.photoNote')}</p>
              {startError && <p className="text-destructive">{startError}</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isStarting}>{t('oauth.connect.notNow')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault(); // stay open until the redirect actually happens (or fails)
              void handleConfirm();
            }}
            disabled={isStarting}
          >
            {isStarting ? t('oauth.connect.redirecting') : t('oauth.connect.continue')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
