/**
 * WHAT `INSTANCE_MODE=managed` CHANGES, written down once, in named questions
 * (M201 spec 07).
 *
 * ── Why a policy and not the boolean it wraps ────────────────────────────
 *
 * `PublicConfig.managed` is a MODE NAME. A screen that branches on it says
 * "this is a managed instance" and nothing at all about WHY this screen cares,
 * so the next screen that should care has no way to learn that it was supposed
 * to ask. That is not a hypothetical: M201 exists because three correct
 * decisions taken for an accountless app (the deleted account menu in
 * `public-wrapper.tsx`, the device-only `avatar-menu.tsx`, the deliberate
 * non-wipe in `sync-actions.ts`) were never revisited when the flag arrived,
 * and a person found all three by hitting them.
 *
 * So the flag is asked ONCE, here, and every screen asks a QUESTION instead.
 * `policy.signOutErasesDevice` carries its own reason; `managed === true` does
 * not. Two things follow that a boolean cannot give:
 *
 * 1. A call site reads as the rule it depends on. A reviewer can tell whether
 *    it is the right rule without knowing the mode's full consequences.
 * 2. The consequences become a LIST, and `tests/unit/instance-policy.test.ts`
 *    freezes that list with each entry annotated by what it governs. Adding a
 *    question without declaring what it does in each mode fails the push.
 *
 * ── Mode is the only input ───────────────────────────────────────────────
 *
 * Every answer below is decided by the mode alone. It could not be otherwise:
 * `isManagedInstance` refuses to boot a managed instance without
 * `SYNC_SERVER_URL`, so "managed" already implies a server exists. The
 * converse is NOT true and is the trap this module must not fall into: a
 * self-hoster may set `SYNC_SERVER_URL` on an OPEN instance, and that instance
 * has sync, no accounts, and the anonymous diary intact. "Is sync configured"
 * is a different question with a different answer, and it stays where it is,
 * in `isSyncConfigured`. A surface that only wants to know whether any sync UI
 * may render must ask that one, never this object.
 *
 * ── Pure, like the module it reads from ──────────────────────────────────
 *
 * This module reads no environment variable and imports nothing outside
 * `#app/config/public-config`, matching the split that file's header
 * documents: parsing here, environment lookup in `index.ts`. That is what lets
 * the freeze test enumerate the whole policy with no environment and no data
 * router. A verification command greps this file for an environment read, so
 * the name of that object is deliberately not written anywhere in it.
 */
import { isManagedInstanceConfig, type InstanceMode, type PublicConfig } from '#app/config/public-config';

/**
 * The questions an instance's mode answers.
 *
 * Every field is a question about BEHAVIOUR, phrased so that the answer reads
 * as a sentence at the call site. None of them is named after the mode: a
 * field called `isManaged` would put the boolean straight back.
 *
 * ── ADDING A FIELD ───────────────────────────────────────────────────────
 * A new field must be answered in BOTH mode objects below (the compiler
 * insists) and must gain a row in `tests/unit/instance-policy.test.ts` saying
 * what it governs (the freeze test insists). Both are the point.
 */
export interface InstancePolicy {
  /**
   * Does a person need an account before they can use this instance at all?
   *
   * `false` on an open instance: the anonymous local diary is the product, and
   * `/onboarding` is reachable by anybody. `true` on a managed one, where the
   * diary only survives inside an account and the AI comes with it, so an
   * anonymous start would be ten minutes of questions into something the
   * person cannot keep (`isAnonymousStartAllowed`).
   */
  readonly requiresAccount: boolean;
  /**
   * Is the `openplate-home` cookie enough, on its own, to send a visitor to
   * `/dashboard`?
   *
   * The cookie is a HINT that this device has been in the app, never a
   * credential. On an open instance the diary is the device's, so the hint is
   * the whole truth and landing on the diary is right. On a managed instance
   * the diary belongs to an ACCOUNT, and a hint left behind by whoever used
   * this device last is not proof that the person holding it now may read that
   * diary. This is the one question whose managed answer is `false`.
   */
  readonly homeCookieProvesSession: boolean;
  /**
   * Does the chrome name a sign-in door?
   *
   * `false` on an open instance, and deliberately: `public-wrapper.tsx`
   * deleted the account menu in M128 because there was nothing behind it, and
   * that is still the right call where nobody has an account. `true` on a
   * managed instance, whose front page otherwise offers a button that silently
   * redirects and never says the words "sign in".
   */
  readonly headerOffersSignIn: boolean;
  /**
   * Must signing out remove the diary from this device?
   *
   * `false` on an open instance, where signing out of sync is not a wipe on
   * purpose (`sync-actions.ts`): the diary was the device's before sync
   * existed and treating sign-out as a delete would make it a terrifying
   * button. `true` on a managed instance, where the diary is the account's. On
   * a device shared inside a household or a study group, a sign-out that
   * leaves the diary readable is the whole point of an account defeated.
   */
  readonly signOutErasesDevice: boolean;
  /**
   * Can the operator of this instance see per-person activity, last sign-in
   * and usage over time?
   *
   * `false` on an open instance, which has no operator, no accounts and no
   * such record to show. `true` on a managed one, where it is the operator's
   * actual job: whoever runs a study has to answer "did these people use it".
   * It is a question about what an ADMINISTRATOR may see, so the privacy copy
   * that instance renders has to say so, which is why it is a policy question
   * and not an admin-page detail.
   */
  readonly operatorSeesActivity: boolean;
  /**
   * Do photo estimates come from this instance's own server, on the account's
   * allowance, rather than from a provider key the person brings?
   *
   * `false` on an open instance: AI is bring-your-own-key, the photo goes from
   * the browser straight to a provider the person chose, and `/settings/ai` is
   * the page where they choose it. `true` on a managed one, where the photo
   * passes through the operator's proxy under the operator's key. It changes
   * who receives a photograph, so it is the question behind every sentence
   * that names the recipient.
   */
  readonly aiComesFromTheInstance: boolean;
  /**
   * Does a copy of the diary reach a server the operator runs?
   *
   * `false` on an open instance even when sync is configured, because sync
   * there is an opt-in the person switches on for themselves and may never
   * touch. `true` on a managed one, where the account keeps an
   * end-to-end-encrypted copy as a matter of course. Ciphertext is still a
   * copy, and the legal copy and the first onboarding screen both have to say
   * so rather than repeat "it never leaves your device".
   */
  readonly serverHoldsTheDiary: boolean;
  /**
   * On a page the onboarding gate lets through untested, does a visitor with
   * no diary here see the PUBLIC chrome rather than the app shell?
   *
   * `true` on a managed instance, where a stranger really can reach
   * `/settings/preferences`, `/settings/account` and `/settings/about` without
   * an account, and where the sidebar, the device chip and the back arrow told
   * them they were inside an app they had never entered (M204 spec 09).
   *
   * `false` on an open instance, and this is the one question whose answer is
   * ARGUABLY the same in both modes: a device with no diary at all gets the
   * gate's `exempt` kind there too, and the public chrome would be honest for
   * it. It is kept as a question, and answered `false`, because the open
   * instance's whole premise is that the diary is the device's and the app is
   * where you already are; a self-hoster opening preferences on a fresh
   * browser is one screen away from starting, not a visitor to somebody
   * else's service. This field is the documented switch for that judgement, so
   * changing it is a one-line decision with a reason attached rather than a
   * rewrite of `_personal.tsx`.
   */
  readonly strangerSeesThePublicShell: boolean;
}

/**
 * The self-host default, and today's app in full.
 *
 * `satisfies` rather than a type annotation: the `anti-slop/no-known-value-widening`
 * rule rejects annotating a known literal, and `satisfies` gives the same
 * missing-field error when `InstancePolicy` grows.
 */
const OPEN_INSTANCE_POLICY = {
  requiresAccount: false,
  homeCookieProvesSession: true,
  headerOffersSignIn: false,
  signOutErasesDevice: false,
  operatorSeesActivity: false,
  aiComesFromTheInstance: false,
  serverHoldsTheDiary: false,
  strangerSeesThePublicShell: false,
} satisfies InstancePolicy;

/** An instance an organization runs for its people: `INSTANCE_MODE=managed`. */
const MANAGED_INSTANCE_POLICY = {
  requiresAccount: true,
  homeCookieProvesSession: false,
  headerOffersSignIn: true,
  signOutErasesDevice: true,
  operatorSeesActivity: true,
  aiComesFromTheInstance: true,
  serverHoldsTheDiary: true,
  strangerSeesThePublicShell: true,
} satisfies InstancePolicy;

/**
 * Both policies, by mode. The freeze test reads THIS, so it sees every
 * question and both answers without naming any of them itself.
 */
export const INSTANCE_POLICIES = {
  open: OPEN_INSTANCE_POLICY,
  managed: MANAGED_INSTANCE_POLICY,
} satisfies Record<InstanceMode, InstancePolicy>;

/**
 * The policy for a mode, for callers that already hold one.
 *
 * @param mode - the parsed `INSTANCE_MODE`.
 * @returns the frozen answers for that mode.
 */
export function instancePolicyForMode(mode: InstanceMode): InstancePolicy {
  return INSTANCE_POLICIES[mode];
}

/**
 * THE GATE for every mode-sensitive branch in the UI.
 *
 * `undefined` config (an error boundary, where the root loader never ran)
 * resolves to the OPEN policy, which is the safe direction and the same one
 * every other reader of `PublicConfig` takes: a screen that cannot read its
 * configuration must not lock somebody out of the app on a guess. The one
 * question where "open" is the more permissive answer, `homeCookieProvesSession`,
 * is read by a redirect that can only send somebody to a screen they may
 * already open, never past a door.
 *
 * @param config - the root loader's public config, or `undefined`.
 * @returns the policy this instance runs under.
 */
export function getInstancePolicy(config: PublicConfig | undefined): InstancePolicy {
  return isManagedInstanceConfig(config) ? MANAGED_INSTANCE_POLICY : OPEN_INSTANCE_POLICY;
}
