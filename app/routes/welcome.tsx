/**
 * `/welcome` — the first screen on a device that holds nothing (M183 spec 02).
 *
 * WHY THIS EXISTS. The `_personal` gate used to read "no local profile" as "new
 * person" and open the first-run questionnaire. It is not the same thing. A
 * returning user's profile row travels inside the encrypted sync snapshot, so
 * it arrives only AFTER they sign in — and until this screen existed there was
 * no door to sign in through. The likely outcomes were re-answering the
 * questionnaire, or creating a second account that never meets the first.
 *
 * So the gate stops here instead and asks. Two doors, no third option and no
 * guessing on the person's behalf: start a new diary, or sign in to the account
 * that already holds one.
 *
 * ON A MANAGED INSTANCE THE TWO DOORS ARE DIFFERENT ONES (M187 spec 03). An
 * instance that declares a gateway hands out accounts and an AI connection
 * together, by invite, so there is no anonymous diary to start: the doors are
 * "sign in" and "I have an invite link", and the second one opens a box for a
 * link that arrived as text rather than as a navigation. Pasting it goes to
 * `/join` with the same fragment the link carries, so there is exactly one
 * implementation of the join ceremony and this screen holds none of it.
 * `/onboarding` is closed on such an instance too — see `isAnonymousStartAllowed` —
 * because hiding the button while leaving the address open is not closing it.
 *
 * WHICH DOOR LEADS depends on what the device carries, and that decision is
 * pure (`app/lib/welcome-hint.ts`) — a remembered sign-in name, or a gateway
 * membership, tips the emphasis towards signing in. It only ever reorders the
 * buttons: neither trace proves an account exists, so neither skips this screen.
 *
 * CLIENT-ONLY and TOP-LEVEL, deliberately. It exports no `loader`, `action` or
 * `clientLoader`: both hints live in the browser (localStorage and IndexedDB),
 * and neither is any of the server's business. It is registered outside
 * `_personal` because that layout's gate is exactly what redirects here —
 * nesting it there would loop, the same reason `/recover` sits outside.
 *
 * WHAT THIS SCREEN MUST NOT DO. It does not clear the home hint cookie and it
 * touches no onboarding state. Landing here is a question, not a decision:
 * `/onboarding` still clears the hint when the person actually chooses to start
 * fresh, which is where that belongs.
 *
 * "NOT YOU?" (M183 spec 04) sits beside the prefilled name and clears the
 * account hint, both in storage and in this screen's own state, so "Start"
 * becomes the primary button on the next paint rather than after a reload.
 * The hint is kept as raw device traces (`useWelcomeHint`), not the derived
 * `WelcomeHint`, precisely so the link can clear one trace without a second
 * IndexedDB read for the other.
 */
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { MetaFunction } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Link } from '#app/components/link';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { useManagedInstance } from '#app/hooks/use-public-config';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { buildJoinFragment, isJoinLinkEmpty, parseJoinLinkInput } from '#app/lib/join-link';
import { clearAccountHint, readAccountHint } from '#app/lib/sync/sync-session';
import { resolveWelcomeHint, type WelcomeHintInput, type WelcomeHint } from '#app/lib/welcome-hint';

export { RouteErrorBoundary as ErrorBoundary };

// This route is top-level, so nothing above it supplies a `<title>`. Title via
// the pure `meta-title` seam, like every other route (see `meta-title.ts`).
export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.welcome') }];

/** Where the first-run questionnaire lives. */
const START_PATH = '/onboarding';

/**
 * Where "I already have an account" goes (M183 spec 03).
 *
 * A page of its own rather than `/settings/sync`, which is a page about a
 * mechanism with a sign-in form buried three taps inside it. `/sign-in` reads
 * the SAME account hint this page reads, so the sign-in name is prefilled
 * there without this link having to carry it.
 */
const SIGN_IN_PATH = '/sign-in';

/**
 * The two device traces, read once on mount, plus the instance's own shape.
 *
 * `null` while the read is in flight, and the screen shows no buttons until it
 * resolves. The alternative — render the no-hint order and swap it a tick later
 * — moves a button under a thumb that is already on its way down, and the read
 * is one localStorage lookup plus one IndexedDB open.
 */
function useWelcomeHint(managed: boolean) {
  // The RAW device trace, not the derived hint — so "Not you?" can clear it
  // and recompute without re-reading anything.
  const [raw, setRaw] = useState<Omit<WelcomeHintInput, 'managed'> | null>(null);

  // AN EFFECT, not a render-time read: `readAccountHint` touches
  // `localStorage`, which does not exist during SSR, and reading it in render
  // would produce a hydration mismatch — a blank screen in this app.
  useEffect(() => {
    setRaw({ accountHint: readAccountHint() });
  }, []);

  // Clears the stored hint AND the on-screen prefill in the same call, so
  // "Start" becomes primary without a reload (M183 spec 04).
  const forgetName = useCallback((): void => {
    clearAccountHint();
    setRaw((current) => (current === null ? current : { ...current, accountHint: null }));
  }, []);

  // `managed` is not a device trace and is not read in the effect: it arrives
  // with the root loader's public config and is already there on the first
  // render. It joins the traces only here, where the decision is made.
  const hint = raw === null ? null : resolveWelcomeHint({ ...raw, managed });
  return { hint, forgetName };
}

/** The primary door, plus the other one underneath it as a quieter button. */
function WelcomeChoices({
  hint,
  onForgetName,
  onPasteInviteLink,
}: {
  hint: WelcomeHint;
  onForgetName: () => void;
  onPasteInviteLink: () => void;
}) {
  const { t } = useTranslation();
  const signInLabel =
    hint.accountName === null ? t('welcome.signIn') : t('welcome.signInAs', { name: hint.accountName });

  if (hint.primary === 'sign-in') {
    return (
      <div className="space-y-3">
        {/* Only when this device really was signed in before. On a managed
            instance signing in leads regardless, and printing this line to a
            first-time visitor there would simply be untrue. */}
        {hint.isReturning && <p className="text-sm text-muted-foreground">{t('welcome.returning')}</p>}
        <Button asChild className="h-11 w-full justify-center">
          <Link to={SIGN_IN_PATH}>{signInLabel}</Link>
        </Button>
        {/* Beside the prefilled name, because that is the thing it disowns.
            A gateway-only hint carries no name, so there is nothing here to
            disown. */}
        {hint.accountName !== null && (
          <button
            type="button"
            onClick={onForgetName}
            className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t('sync.signIn.notYou')}
          </button>
        )}
        <SecondaryAction action={hint.secondary} onPasteInviteLink={onPasteInviteLink} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button asChild className="h-11 w-full justify-center">
        <Link to={START_PATH}>{t('welcome.start')}</Link>
      </Button>
      <SecondaryAction action={hint.secondary} onPasteInviteLink={onPasteInviteLink} />
    </div>
  );
}

/**
 * The quieter button under the primary one, whichever of the three it is.
 *
 * One component rather than three inline branches, so "the secondary action"
 * is a single thing the resolver decides and this file only renders.
 */
function SecondaryAction({
  action,
  onPasteInviteLink,
}: {
  action: WelcomeHint['secondary'];
  onPasteInviteLink: () => void;
}) {
  const { t } = useTranslation();

  if (action === 'invite-link') {
    return (
      <Button type="button" variant="outline" className="h-11 w-full justify-center" onClick={onPasteInviteLink}>
        {t('welcome.managed.haveInvite')}
      </Button>
    );
  }
  if (action === 'sign-in') {
    return (
      <Button asChild variant="outline" className="h-11 w-full justify-center">
        <Link to={SIGN_IN_PATH}>{t('welcome.haveAccount')}</Link>
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" className="h-11 w-full justify-center">
      <Link to={START_PATH}>{t('welcome.startFresh')}</Link>
    </Button>
  );
}

/**
 * One box for a link that arrived as text.
 *
 * It reimplements NOTHING of the join ceremony. What is pasted is parsed by
 * the one join-link grammar (`app/lib/join-link.ts`), rewritten as the same
 * fragment an opened link carries, and handed to `/join` — which then reads it
 * exactly as it reads a link somebody tapped.
 *
 * A DOCUMENT navigation rather than a router `navigate`, for the reason
 * `/connect-gateway` gives: a client-side navigation can be dropped, and this
 * one carries the only copy of a single-use capability. `assign` rather than
 * `replace` so Back still returns here from a link that turns out to be wrong.
 */
function PasteInviteLink({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [isRejected, setIsRejected] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const link = parseJoinLinkInput(value);
    if (isJoinLinkEmpty(link)) {
      // Nothing usable in it. Said here rather than by navigating to `/join`
      // and letting it show its invalid-link card, so the box the person has
      // to correct is still on screen with what they pasted in it.
      setIsRejected(true);
      return;
    }
    globalThis.window.location.assign(`/join${buildJoinFragment(link)}`);
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <p className="text-sm font-medium">{t('welcome.managed.pasteTitle')}</p>
      <div className="space-y-2">
        <Label htmlFor="welcome-invite-link">{t('welcome.managed.pasteLabel')}</Label>
        <Input
          id="welcome-invite-link"
          name="inviteLink"
          type="text"
          inputMode="url"
          autoComplete="off"
          className="h-11"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setIsRejected(false);
          }}
        />
        <p className="text-xs text-muted-foreground">{t('welcome.managed.pasteHint')}</p>
        {isRejected && <p className="text-sm text-red-600 dark:text-red-400">{t('welcome.managed.pasteInvalid')}</p>}
      </div>
      <Button type="submit" className="h-11 w-full justify-center" disabled={value.trim() === ''}>
        {t('welcome.managed.pasteContinue')}
      </Button>
      <Button type="button" variant="ghost" className="h-11 w-full justify-center" onClick={onCancel}>
        {t('sync.cancel')}
      </Button>
    </form>
  );
}

export default function Welcome() {
  const { t } = useTranslation();
  const managed = useManagedInstance();
  const { hint, forgetName } = useWelcomeHint(managed);
  const [isPastingLink, setIsPastingLink] = useState(false);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('welcome.title')}</CardTitle>
          {/* The open body offers starting a diary, which is not on offer
              here — so a managed instance says what its two doors are. */}
          <CardDescription>{managed ? t('welcome.managed.body') : t('welcome.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isPastingLink && <PasteInviteLink onCancel={() => setIsPastingLink(false)} />}
          {!isPastingLink && hint === null && (
            <div className="flex justify-center py-4" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="sr-only">{t('chrome.loading')}</span>
            </div>
          )}
          {!isPastingLink && hint !== null && (
            <WelcomeChoices hint={hint} onForgetName={forgetName} onPasteInviteLink={() => setIsPastingLink(true)} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
