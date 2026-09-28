/**
 * The first pull after a credential succeeds, shared by `/sign-in` and
 * `/reset`.
 *
 * ── Why the pull is not optional ─────────────────────────────────────────
 *
 * Opening a session proves nothing about where the person belongs. The profile
 * row, `onboardingCompletedAt` and all, travels INSIDE the encrypted snapshot,
 * so until the first pull has finished a device that has just signed in looks
 * exactly like a fresh install and the gate sends a ten-year user into the
 * first-run questionnaire.
 *
 * `/reset` skipped this. Walking 0.10.1 on 2026-09-04: the escrow worked, the
 * password was set, the session opened, and the person was handed the
 * questionnaire while their diary sat undownloaded on the server. It arrived
 * later, on the background sync, behind the answers they had just given. Two
 * screens with one rule between them is one screen too many, so the rule moved
 * here.
 *
 * ── A failed pull is not a failed sign-in ────────────────────────────────
 *
 * The session stays OPEN, the screen says only that the diary did not arrive,
 * and the retry repeats the pull alone. It never asks for the password again,
 * and it never falls through to `/onboarding` — that fall-through is the bug
 * M183 spec 03 exists to kill, and this hook is where it stays killed.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { completeSignIn, resolveSignInDestination, type SignInDestination } from '#app/lib/sign-in-flow';
import { readOnboardingGateKind } from '#app/lib/read-onboarding-gate';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import { syncNow } from '#app/lib/sync/sync-actions';

/** What a screen running the first pull is showing. `idle` is "the pull has not started". */
export type FirstPullPhase =
  | { status: 'idle' }
  | { status: 'pulling' }
  /** Signed in, snapshot missing. `message` is what went wrong, in the person's language. */
  | { status: 'pull-failed'; message: string };

/**
 * Reads the freshly pulled store and asks the onboarding gate where this
 * device belongs.
 *
 * The gate read itself lives in `read-onboarding-gate.ts`, because three
 * screens now ask this question and three readers would be three chances to
 * read a different set of facts.
 */
async function readDestination(): Promise<SignInDestination> {
  return resolveSignInDestination({ gate: await readOnboardingGateKind() });
}

export interface FirstPull {
  phase: FirstPullPhase;
  /** Runs the pull, then hands the destination to `onArrived`. Safe to call again as the retry. */
  start: () => void;
}

/**
 * @param onArrived - called with the path once the snapshot is in the local
 *   store. Each screen does its own last piece of business here: `/sign-in`
 *   spends a parked invitation, `/reset` has none to spend.
 */
export function useFirstPull({ onArrived }: { onArrived: (path: SignInDestination) => void }): FirstPull {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<FirstPullPhase>({ status: 'idle' });

  const start = useCallback((): void => {
    const run = async (): Promise<void> => {
      setPhase({ status: 'pulling' });
      const outcome = await completeSignIn({ pull: syncNow, readDestination });
      if (outcome.status === 'pull-failed') {
        setPhase({ status: 'pull-failed', message: describeErrorForUser(outcome.cause, t('signIn.pullFailedBody')) });
        return;
      }
      onArrived(outcome.path);
    };
    void run();
  }, [onArrived, t]);

  return { phase, start };
}
