/**
 * THE ACCOUNT DOOR: a managed instance's `/` for a visitor with no session
 * (M266 design, steps 3 and 9, approved by the owner on 2026-09-29).
 *
 * ── One rule: openplate.de sells and explains, every app host is a door ───
 *
 * The managed landing was a second marketing page: the same pitch as the
 * project site, its own copy of the offer, screenshots, a newsletter. So it
 * drifted, and it was the extra thing in front of a door that already existed
 * (`/welcome`). This page is the door, and nothing else:
 *
 *  1. the lockup, the mark and the name;
 *  2. ONE sentence that is true of this instance (the managed hero sentence:
 *     what openplate is, and that the operator's server keeps an encrypted
 *     copy);
 *  3. the doors the handshake allows: "Sign up" first and "Sign in" where
 *     anybody may ask for an account, "Sign in" first and "I have an invite
 *     link" where only an invitation opens one;
 *  4. the small print in one reserved box: the offer (free scans, then the
 *     prices, `SignupOffer`) where a plan is sold, or "Invitation only";
 *  5. one quiet line to openplate.de, in the reader's language, for what
 *     openplate is and what it costs.
 *
 * No screenshots, no "how it works", no newsletter form, no `/dashboard`. The
 * header's two doors step aside here (`showDoors`), so no door is drawn twice.
 *
 * ── Nothing moves while the handshake and the price read land ────────────
 *
 * The server renders no handshake, so the first paint cannot know which doors
 * are true. Both boxes are there from the first paint (DESIGN.md section 7):
 * the doors cell holds the invite-only pair, invisible and inert, and the
 * sign-up pair is drawn into the same cell only once the handshake says so,
 * so the markup of an invite-only instance never carries a "Sign up". The
 * small print box keeps the offer's measured height whichever line it ends up
 * holding. `tests/e2e/account-door-page.spec.ts` reads a layout-shift total of
 * 0 across both reads, in six languages at 320, 390 and 412 px.
 */
import { useState, type ReactElement } from 'react';
import { useLocation } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';

import { Link } from '#app/components/link';
import { PasteInviteLink } from '#app/components/paste-invite-link';
import { SignupOffer } from '#app/components/plans/signup-offer';
import PublicWrapper from '#app/components/public-wrapper';
import { Button } from '#app/components/ui/button';
import { Wordmark } from '#app/components/wordmark';
import { SIGN_UP_PATH } from '#app/components/account-door';
import { useProjectSiteUrl } from '#app/hooks/use-project-site-url';
import { usePublicPlanPrices } from '#app/hooks/use-public-plan-prices';
import { useServerInstanceRead } from '#app/hooks/use-server-instance';
import { PROJECT_SITE_HOST } from '#app/lib/brand';
import { trackLandingCtaClicked } from '#app/lib/matomo-events';
import { hasPlansDoor } from '#app/lib/plans/plans-door';
import { hasOpenSignup, offeredTrialScans } from '#app/lib/plans/signup-door';
import type { InstanceDescriptor } from '#app/lib/sync/engine/protocol';
import { cn } from '#app/lib/utils';

/** Where "Sign in" goes, on both kinds of door. */
const SIGN_IN_PATH = '/sign-in';

/**
 * Which doors the handshake leaves open.
 *
 * - `unknown`: not answered yet. The cell keeps its box and shows nothing.
 * - `invite-only`: "Sign in" and "I have an invite link". Also every answer
 *   that is not a clear yes: an unreachable service, an older core, a body
 *   that does not parse (`hasOpenSignup` reads all of those as invite-only).
 * - `sign-up`: "Sign up" and "Sign in". The sign-up link keeps the query
 *   string, so `?plan=` from the pricing page reaches the form.
 */
type Door = { kind: 'unknown' } | { kind: 'invite-only' } | { kind: 'sign-up'; signUpHref: string };

/** The handshake's answer, read once for the whole page. */
interface DoorRead {
  door: Door;
  instance: InstanceDescriptor | null;
}

function useDoorRead(): DoorRead {
  const { isSettled, instance } = useServerInstanceRead();
  const { search } = useLocation();
  if (!isSettled) return { door: { kind: 'unknown' }, instance };
  if (!hasOpenSignup(instance)) return { door: { kind: 'invite-only' }, instance };
  return { door: { kind: 'sign-up', signUpHref: `${SIGN_UP_PATH}${search}` }, instance };
}

/** One pair of doors, a filled button over an outlined one, full width. */
const DOOR_STACK_CLASS = 'flex w-full flex-col gap-3';

/** Each door's box: the phone tap height, the label centred. */
const DOOR_CLASS = 'h-11 w-full justify-center';

/**
 * The height the small print keeps from the first paint: the offer at its
 * tallest, the free scans and the price sentence at `text-xs` in this page's
 * column. The price line already reserves its widest sentence itself
 * (`SignupOffer`), so the offer's height does not depend on the prices; it
 * depends on the language and the width. MEASURED in the production build on
 * 2026-09-29: 100 px below 390 px (German, French, Italian and Spanish at 320,
 * Italian at 360), 84 px from 390 (Italian), 68 px from 412 in every language.
 * `tests/e2e/account-door-page.spec.ts` holds the handshake and the price read,
 * lets them through, and requires a layout-shift total of 0 at 320, 390 and
 * 412 px in all six languages, so a longer translation fails there.
 */
const SMALL_PRINT_RESERVE = 'min-h-[6.25rem] min-[390px]:min-h-[5.25rem] min-[412px]:min-h-[4.25rem]';

/**
 * The doors cell. The invite-only pair is always in it, so its box is there
 * from the first paint; it turns visible only on an invite-only answer. The
 * sign-up pair is drawn into the same cell only on a sign-up answer.
 *
 * `[&_*]:transition-none` while hidden: the shared `Button` transitions every
 * property, `visibility` included, and a hidden layer must stop painting in
 * the frame it is hidden (`tests/e2e/invisible-button-flash.spec.ts`).
 */
function Doors({ door, onPasteInviteLink }: { door: Door; onPasteInviteLink: () => void }): ReactElement {
  const { t } = useTranslation();
  const isInviteOnlyShown = door.kind === 'invite-only';
  return (
    <div data-slot="account-door-doors" className="mt-8 grid w-full [&>*]:col-start-1 [&>*]:row-start-1">
      <div
        className={cn(DOOR_STACK_CLASS, !isInviteOnlyShown && 'invisible [&_*]:transition-none')}
        inert={!isInviteOnlyShown}
      >
        <Button asChild className={DOOR_CLASS}>
          <Link to={SIGN_IN_PATH} data-door="primary" onClick={() => trackLandingCtaClicked('hero')}>
            {t('chrome.signIn')}
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className={DOOR_CLASS}
          data-door="secondary"
          onClick={onPasteInviteLink}
        >
          {t('welcome.managed.haveInvite')}
        </Button>
      </div>
      {door.kind === 'sign-up' && (
        <div className={DOOR_STACK_CLASS}>
          <Button asChild className={DOOR_CLASS}>
            <Link to={door.signUpHref} data-door="primary" onClick={() => trackLandingCtaClicked('hero')}>
              {t('chrome.signUp')}
            </Link>
          </Button>
          <Button asChild variant="outline" className={DOOR_CLASS}>
            <Link to={SIGN_IN_PATH} data-door="secondary">
              {t('chrome.signIn')}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The small print, in one box reserved from the first paint.
 *
 * WHERE A PLAN IS SOLD to anybody who signs up: the free scans and what
 * openplate costs after them, the same lines `/sign-up` draws, the price line
 * holding its own box while the anonymous price read is in flight.
 *
 * ON AN INVITE-ONLY INSTANCE (step 9, the beta line): "Invitation only", in the
 * same box, so the page is laid out the same whichever instance answers. An
 * instance that takes sign-ups and sells nothing says neither: it offers no
 * scans to count and invites nobody.
 */
function SmallPrint({ read }: { read: DoorRead }): ReactElement {
  const { t } = useTranslation();
  const trialScans = offeredTrialScans(read.instance);
  const showsOffer = read.door.kind === 'sign-up' && hasPlansDoor(read.instance) && trialScans !== null;
  const prices = usePublicPlanPrices({ isEnabled: showsOffer });
  return (
    <div data-slot="account-door-small-print" className={cn('mt-6 w-full', SMALL_PRINT_RESERVE)}>
      {read.door.kind === 'invite-only' && (
        <p data-slot="account-door-invite-only" className="text-xs text-muted-foreground">
          {t('accountDoor.inviteOnly')}
        </p>
      )}
      {showsOffer && <SignupOffer trialScans={trialScans} prices={prices} chosenPlan={null} size="xs" />}
    </div>
  );
}

/** The quiet line to the project site, where the pitch and the prices live, in the reader's language. */
function SiteLine(): ReactElement {
  const siteHref = useProjectSiteUrl('/');
  return (
    <p data-slot="account-door-site-line" className="mt-8 text-sm text-muted-foreground">
      <Trans
        i18nKey="accountDoor.siteLine"
        values={{ site: PROJECT_SITE_HOST }}
        components={{
          site: (
            <a
              href={siteHref}
              className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
            >
              {/* `<Trans>` replaces this with the linked run from the catalog; it is the fallback. */}
              {PROJECT_SITE_HOST}
            </a>
          ),
        }}
      />
    </p>
  );
}

/**
 * The page. `index.tsx` draws it where `frontDoorIsTheAccountDoor` is true and
 * keeps everything else of the route: the loaders, the meta, the three paths
 * into the app for a device that already has a session.
 */
export function AccountDoorPage(): ReactElement {
  const { t } = useTranslation();
  const read = useDoorRead();
  // THE PASTE BOX OPENS IN PLACE of the doors, for an invite that arrived as
  // text. It is an expansion the person asked for, below everything above the
  // tap, and "Cancel" puts the doors back.
  const [isPastingLink, setIsPastingLink] = useState(false);

  return (
    <PublicWrapper showDoors={false}>
      <div data-slot="account-door-page" className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
        {/* The one lockup this app draws (the public header, the sidebar,
            `/welcome`): the icon asset and `Wordmark`, never a second recipe.
            `alt=""` because the word beside it says the name. */}
        <span data-slot="account-door-brand" className="flex items-center gap-3">
          <img src="/icons/icon-192.png?v=2" alt="" className="h-10 w-10" />
          <Wordmark as="h1" besideMark className="text-4xl" />
        </span>
        <p data-slot="account-door-lead" className="mt-6 leading-relaxed text-foreground">
          {t('landing.hero.taglineManaged')}
        </p>
        {isPastingLink ?
          <div data-slot="account-door-paste" className="mt-8 w-full text-left">
            <PasteInviteLink onCancel={() => setIsPastingLink(false)} />
          </div>
        : <Doors door={read.door} onPasteInviteLink={() => setIsPastingLink(true)} />}
        <SmallPrint read={read} />
        <SiteLine />
      </div>
    </PublicWrapper>
  );
}
