/**
 * What the screens are allowed to show (M235/06).
 *
 * The three visible surfaces, the streak card, the awards screen and the
 * one-line note, each have to answer the same two questions: is this person
 * showing this at all, and which award, if any, has not been acknowledged yet.
 * Both answers live here so the three cannot disagree, and both are PURE: the
 * profile row, the award rows and the marks all arrive as arguments, which is
 * what lets a test render the hidden case and its control side by side without
 * a store.
 *
 * Nothing here decides whether to RECORD anything. Recording runs whatever the
 * switch says (`record.ts`), so a person who turns the streak back on is shown
 * the record they actually have rather than a hole where the months they hid
 * it used to be.
 */
import { activeDayKeys, computeActiveStreak } from './streak';
import { awardDefinition, AWARDS } from './catalog';
import type { AwardDefinition, AwardKind } from './catalog';
import type { LocalActivityMark, LocalAward } from '#app/lib/local-store/schema';

/** As much of the profile row as the switch needs. Narrow on purpose: nothing here reads a goal. */
export interface GamificationVisibility {
  gamificationHidden?: boolean | null;
}

/**
 * Whether the streak, the awards screen and the note are switched off.
 *
 * Absent, null and false all mean "show them": the field is a decision a person
 * took, and no decision is not a decision to hide. A missing profile row is the
 * same case, which is the device that has never onboarded.
 *
 * @param profile - the stored profile row, or null when there is none yet.
 * @returns whether every gamification surface must render nothing.
 */
export function isGamificationHidden(profile: GamificationVisibility | null): boolean {
  return profile?.gamificationHidden === true;
}

/**
 * The current activity streak for a device's marks.
 *
 * One line, and it exists so the dashboard and Trends cannot each assemble the
 * walk their own way: two streak numbers that disagreed is the defect this
 * milestone exists to fix.
 *
 * @param options.marks - every mark held on this device.
 * @param options.today - the person's current local day, `YYYY-MM-DD`.
 * @returns the number of consecutive active days ending today or yesterday.
 */
export function deriveActivityStreak({ marks, today }: { marks: readonly LocalActivityMark[]; today: string }): number {
  return computeActiveStreak({ activeDays: activeDayKeys(marks), today });
}

/**
 * The one award whose note has not been shown yet, or null.
 *
 * Returns null whenever the surfaces are hidden, so the note cannot fire behind
 * a switch that is off. A key this build does not know is skipped rather than
 * shown: `awardDefinition` returns undefined for it, and a note has no words
 * without a definition to read them from.
 *
 * Oldest first, because `listLocalAwards` sorts that way and a person who
 * earned two at once should be told about them in the order they happened.
 *
 * @param options.awards - the awards this device holds.
 * @param options.hidden - whether the surfaces are switched off.
 * @returns the award to note, or null when there is nothing to say.
 */
export function selectUnseenAward({
  awards,
  hidden,
}: {
  awards: readonly LocalAward[];
  hidden: boolean;
}): LocalAward | null {
  if (hidden) return null;
  return awards.find((award) => award.seenAt === null && awardDefinition(award.key) !== undefined) ?? null;
}

/** The three families, in the order the awards screen lists them. */
export const AWARD_KINDS = ['explorer', 'streak', 'onplan'] as const;

/** The section heading for a family. Derived from the id, so a fourth family cannot ship without its copy key. */
export function awardSectionKey(kind: AwardKind): string {
  return `awards.section.${kind}`;
}

/**
 * Every award in one family, in catalog order.
 *
 * @param kind - the family to list.
 * @returns the definitions, which is what the screen renders whether or not they are earned.
 */
export function awardsOfKind(kind: AwardKind): AwardDefinition[] {
  return AWARDS.filter((award) => award.kind === kind);
}
