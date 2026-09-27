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
import { NeedsHttpsNotice } from '#app/components/needs-https-notice';
import { Button, buttonVariants } from '#app/components/ui/button';
import { useCanRunAccounts } from '#app/hooks/use-can-run-accounts';
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
 *
 * ── Off a secure context it is a notice, not a button ────────────────────
 *
 * PKCE hashes its verifier with `crypto.subtle.digest`, and a plain-http page
 * off this computer has no `crypto.subtle`. The install rehearsal of
 * 2026-09-27 found "Continue to OpenRouter" throwing there and saying "check
 * your connection", which blamed the network. So the button gives way, in
 * place, to the same notice the account pages draw, worded for this door.
 * Pasting a key needs no `crypto.subtle` (one `fetch` to the provider, one
 * write to the device's store), so every caller keeps offering that path.
 */
export function OAuthConnectButton({ className, variant = 'default', children }: OAuthConnectButtonProps) {
  // The label default lives here, not in the parameter list: a default value
  // can't call a hook, and a caller-supplied `children` still wins.
  const { t } = useTranslation();
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // The same question the account pages ask: is `crypto.subtle` here?
  const canUseWebCrypto = useCanRunAccounts();

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

  if (!canUseWebCrypto) {
    return (
      <NeedsHttpsNotice
        slot="oauth-needs-https"
        title={t('oauth.connect.needsHttps.title')}
        body={t('oauth.connect.needsHttps.body')}
        className="w-full sm:flex-1"
      />
    );
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
