/**
 * "2 others are fasting right now", on the active fast card.
 *
 * One sentence, and only above the floor. `othersFastingLine` subtracts the
 * reader from the instance-wide count and returns `null` below three, so this
 * component can never render a zero: "0 others are fasting" is worse than
 * saying nothing, and it is the sentence a person would remember.
 *
 * Split in two for the same reason the tile is: the view takes a value, the
 * slot is the line the route mounts.
 */
import { useTranslation } from 'react-i18next';

import { usePulseToday } from '#app/hooks/use-pulse-today';
import { othersFastingLine, type PulseToday } from '#app/lib/pulse';

/** The line, driven by a value. Renders `null` under the floor. */
export function PulseFastingLine({ today }: { today: PulseToday | null }) {
  const { t } = useTranslation();
  const others = othersFastingLine(today);
  if (others === null) return null;
  return <p className="text-sm text-muted-foreground">{t('pulse.fasting.others', { count: others })}</p>;
}

/** The `/fasting` card's one line. */
export function PulseFastingLineSlot() {
  const today = usePulseToday();
  return <PulseFastingLine today={today} />;
}
