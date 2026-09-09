/**
 * CAN THIS DEVICE RUN AN AI INTAKE, asked once for every way in.
 *
 * IT IS A HOOK BECAUSE THE ANSWER IS AN INDEXEDDB ROUND TRIP on an open
 * instance, and every add-food surface needs it before it can promise
 * anything: the camera gesture must not ask for a permission the feature
 * cannot use (`use-camera-capture.ts`), the search screen must not offer "Log
 * with AI" to somebody who has no AI, and `/describe` must not offer to send a
 * sentence nothing will read. One read, one rule, three surfaces.
 *
 * `unknown` is its own member and is NEVER treated as connected. The read only
 * starts after hydration, and in that window the honest answer is that nobody
 * knows yet, so every caller behaves exactly as it does for a device with no
 * provider and corrects itself a moment later rather than promising first.
 *
 * ── WHY IT IS NOT THE BYOK ROW ANY MORE (0.20.0 blocker) ─────────────────
 *
 * This hook used to read `getLocalAiSettings()` and nothing else. A MANAGED
 * instance stores no such row on purpose: the AI comes from the instance's own
 * server on the account's allowance and is DERIVED from the session, never
 * saved (`app/lib/ai/managed-ai-settings.ts`). So on production, which is
 * managed, the row was absent for everybody, Send was disabled forever, and
 * the notice under it pointed at `/settings/ai`, a page a managed instance
 * redirects away from. `/scan` was right the whole time because it asks
 * `resolveEffectiveAiSettings`; these screens asked a different question and
 * got a different answer for the same device.
 *
 * So the question is now resolved by THE SAME RULE `/scan` builds its request
 * from, and the BYOK row is only one of that rule's inputs. Two screens cannot
 * disagree about a device again.
 */
import { useEffect, useState } from 'react';
import { getLocalAiSettings, type LocalAiSettings } from '#app/lib/local-store';
import { useEffectiveAiSettings } from '#app/hooks/use-effective-ai-settings';
import { useInstancePolicy } from '#app/hooks/use-public-config';
import { useSyncSession } from '#app/components/sync-status';
import { resolveAllowanceDoor } from '#app/lib/ai/managed-ai-settings';
import type { AllowanceDoor, EffectiveAiSettings } from '#app/lib/ai/managed-ai-settings';
import { useServerInstance } from '#app/hooks/use-server-instance';

export type AiConnection = 'unknown' | 'connected' | 'absent';

/**
 * Where a person with no AI is sent, which is not the same question as whether
 * they have one.
 *
 * - `byok`: an open instance, where the answer is the person's own provider
 *   and `/settings/ai` is the page that takes it.
 * - the three ALLOWANCE doors, on a managed instance, where nobody brings a
 *   provider and the only thing that can be missing is the allowance. Which of
 *   the three is a fact about the account and the instance rather than about
 *   this screen, so it is resolved by {@link resolveAllowanceDoor} and reused
 *   verbatim by `/scan`'s `managed-missing` card and by the account page. None
 *   of them carries a link, because none of them is fixed by a page: the door
 *   is a person on an organization's instance, and on a consumer instance
 *   there is nobody to send anybody to (M212 spec 04).
 *
 * ── THERE IS NO SIGNED-OUT DOOR ANY MORE (M204 spec 01) ──────────────────
 *
 * A third member used to name a managed instance with no session, and sent
 * the person to the screen that reopens one. It cannot happen on the screens
 * that read this. Signing out of a managed instance LOCKS the device:
 * `signOutErasesDevice` makes `sign-out-flow.ts` call `lockDevice()`, and a
 * server-refused session does the same through `session-cache.ts`. Then
 * `_personal.tsx`'s gate reads that marker synchronously and sends every
 * personal route, `/describe` and `/add` included, to `/welcome`, through
 * `resolveOnboardingGate`'s `isDeviceLocked && !hasSyncAccount` branch. A
 * managed instance's diary belongs to the account, so "signed out" and "these
 * screens are closed" are one fact, and the notice for the second one was a
 * sentence nobody could read. The walk that found it is in the worklog under
 * "M201, the managed walk of the meal composer on 0.20.1".
 *
 * The alternative was an exception to that lock for the two add-food screens.
 * It was refused: `/add` lists this device's own foods and both screens WRITE
 * to the diary, so exempting them would hand the next person on a shared
 * device the last person's rows, which is the one thing the lock exists to
 * stop.
 */
export type AiIntakeDoor = { kind: 'byok' } | AllowanceDoor;

/** What a screen needs to decide whether to offer an AI intake, and what to say when it cannot. */
export interface AiIntake {
  connection: AiConnection;
  /** Only read when `connection` is `absent`; the other two states show no notice at all. */
  door: AiIntakeDoor;
}

/**
 * THE PURE HALF. Given the settings rule's answer and the two loading facts,
 * which of the three states this device is in.
 *
 * A managed instance never waits for the device row (the rule refuses it
 * outright) and always waits for the RESUME, because a session being reopened
 * looks exactly like no session at all and the two answers are opposite. An
 * open instance is the mirror image: no session is involved, and the row is
 * the whole answer, so it waits for the read.
 */
export function resolveAiConnection({
  aiComesFromTheInstance,
  isSessionResuming,
  hasReadDeviceRow,
  effectiveSettings,
}: {
  aiComesFromTheInstance: boolean;
  isSessionResuming: boolean;
  hasReadDeviceRow: boolean;
  effectiveSettings: EffectiveAiSettings | null;
}): AiConnection {
  if (aiComesFromTheInstance) {
    if (isSessionResuming) return 'unknown';
    return effectiveSettings === null ? 'absent' : 'connected';
  }
  if (!hasReadDeviceRow) return 'unknown';
  return effectiveSettings === null ? 'absent' : 'connected';
}

/**
 * THE OTHER PURE HALF: which door the notice names.
 *
 * The resuming moment needs no answer here, because `resolveAiConnection`
 * reports `unknown` for it and no notice is drawn at all.
 *
 * THE SESSION IS NOT AN INPUT, and that is the M204 spec 01 decision rather
 * than an omission: a managed device with no session never renders this
 * notice, because the lock has already sent it to `/welcome`. See
 * {@link AiIntakeDoor}.
 */
export function resolveAiIntakeDoor({
  aiComesFromTheInstance,
  allowance,
}: {
  aiComesFromTheInstance: boolean;
  /**
   * The account and instance facts the three managed doors are told apart by.
   *
   * REQUIRED, with no default, and that is deliberate. A default of "no
   * invitations, no end date" would compile at every call site and answer
   * `ask-admin` for ever on the one instance where nobody can be asked, which
   * is a correctness argument threaded to nowhere.
   */
  allowance: { memberInvites: boolean; allowanceExpiresAt: string | null; now: Date };
}): AiIntakeDoor {
  if (!aiComesFromTheInstance) return { kind: 'byok' };
  return resolveAllowanceDoor(allowance);
}

/** Whether this device may run an AI intake right now, and where to send a person who may not. */
export function useAiIntake(): AiIntake {
  const { aiComesFromTheInstance } = useInstancePolicy();
  const session = useSyncSession();
  // ONE CACHED `/health` READ FOR THE WHOLE TAB (`use-server-instance.ts`), so
  // asking it here costs nothing on a screen where something else already has.
  const instance = useServerInstance();
  const [deviceRow, setDeviceRow] = useState<LocalAiSettings | null>(null);
  const [hasReadDeviceRow, setHasReadDeviceRow] = useState(false);

  useEffect(() => {
    // A managed instance refuses a BYOK row even when one exists, so opening
    // the AI database there would be a second IndexedDB round trip for a value
    // nothing reads.
    if (aiComesFromTheInstance) return;
    let isMounted = true;
    const read = async (): Promise<void> => {
      const settings = await getLocalAiSettings();
      if (!isMounted) return;
      setDeviceRow(settings);
      setHasReadDeviceRow(true);
    };
    void read();
    return () => {
      isMounted = false;
    };
  }, [aiComesFromTheInstance]);

  const effectiveSettings = useEffectiveAiSettings(deviceRow);

  return {
    connection: resolveAiConnection({
      aiComesFromTheInstance,
      isSessionResuming: session.isResuming,
      hasReadDeviceRow,
      effectiveSettings,
    }),
    door: resolveAiIntakeDoor({
      aiComesFromTheInstance,
      allowance: {
        // The instance's own answer, never a guess: an unreachable or older
        // service reads `false`, which keeps the sentence that names an
        // administrator rather than inventing an invite card.
        memberInvites: instance?.memberInvites ?? false,
        allowanceExpiresAt: session.account?.allowanceExpiresAt ?? null,
        now: new Date(),
      },
    }),
  };
}

/** The connection alone, for a caller with nothing to say when it is absent. */
export function useAiConnection(): AiConnection {
  return useAiIntake().connection;
}
