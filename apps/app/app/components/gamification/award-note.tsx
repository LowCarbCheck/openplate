/**
 * The one-line note for a newly earned award (M235/06), shown once.
 *
 * ── THE ONE RENDER-TIME WRITE IN THIS MILESTONE, AND WHERE IT HAPPENS ────
 *
 * `seenAt` is stamped in an effect AFTER the paint that shows the note, which
 * is the precedent `app/lib/celebration.ts` set for the four one-time notes it
 * banks in `localStorage`. Writing during render would stamp a note that a
 * navigation, a crash or a suspended render could mean nobody ever read, and
 * the row is write-once apart from this one field, so there is no way back.
 * Stamping after the paint can at worst repeat a note (the merge can lose the
 * field, see M235/03), which is the harmless direction.
 *
 * ── WHY IT READS THE STORE AND THE CARD DOES NOT ─────────────────────────
 *
 * The awards this device holds are not on any route's loader: a note can
 * become true between two renders of the same screen, because a sync pull
 * reconciles awards after it lands. So this one reads for itself, after mount,
 * and the decision it reads WITH is pure and lives in
 * `#app/lib/gamification/surfaces` where the card and the screen read it too.
 *
 * With the surfaces switched off it renders nothing and stamps nothing, so
 * switching back on later still shows a true record.
 *
 * No loss language, no score, no count: one sentence naming the award, and it
 * goes away by itself.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Award } from 'lucide-react';

import { Card, CardContent } from '#app/components/ui/card';
import { awardDefinition } from '#app/lib/gamification/catalog';
import { selectUnseenAward } from '#app/lib/gamification/surfaces';
import { listLocalAwards, markAwardSeen } from '#app/lib/local-store';
import type { LocalAward } from '#app/lib/local-store';
import { reportError } from '#app/lib/report-error';

/**
 * The note, or nothing.
 *
 * @param hidden - whether the person switched the streak and the awards off.
 * @returns the one-line note for the oldest unacknowledged award, or null.
 */
export function AwardNote({ hidden }: { hidden: boolean }): ReactElement | null {
  const { t } = useTranslation();
  const [award, setAward] = useState<LocalAward | null>(null);

  useEffect(() => {
    if (hidden) return;
    let isCancelled = false;
    async function readUnseen(): Promise<void> {
      try {
        const awards = await listLocalAwards();
        if (isCancelled) return;
        setAward(selectUnseenAward({ awards, hidden }));
      } catch (error) {
        // A badge must never take a screen down: the read is reported and the
        // page renders exactly as it would with nothing to say.
        reportError(error, { boundary: 'award-note-read' });
      }
    }
    void readUnseen();
    return () => {
      isCancelled = true;
    };
  }, [hidden]);

  // AFTER PAINT, and in its own effect keyed on the award, so the stamp follows
  // the render that showed the sentence rather than the read that found it.
  useEffect(() => {
    if (award === null) return;
    const key = award.key;
    async function bankSeen(): Promise<void> {
      try {
        await markAwardSeen({ key, seenAt: Date.now() });
      } catch (error) {
        // Worst case the note is shown once more, which is the harmless
        // direction and the same one a lost merge takes (M235/03).
        reportError(error, { boundary: 'award-note-seen', key });
      }
    }
    void bankSeen();
  }, [award]);

  if (award === null) return null;
  // An award minted by a NEWER build is held, never rendered: there are no
  // words for a key this build's catalog does not carry.
  const definition = awardDefinition(award.key);
  if (definition === undefined) return null;

  return (
    <Card className="border-primary/40">
      <CardContent className="flex items-center gap-2 p-4 text-sm font-medium">
        <Award className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        {t('awards.note', { title: t(definition.titleKey) })}
      </CardContent>
    </Card>
  );
}
