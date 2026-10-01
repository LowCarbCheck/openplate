/**
 * The card a screen shows when the connected AI server has said, in its own
 * `/models`, that it does not run the task this screen is for.
 *
 * ── Not the connect card, and not a failure ──────────────────────────────
 *
 * `ConnectCard` answers "there is no AI". This answers "there is one, and it
 * does one thing, which is not this". A self-hosted openplate-inference
 * service reads plate photos and refuses the pantry and the recipes, and the
 * call used to fail after the tap with a message nobody could act on. The card
 * says it BEFORE the tap and names the one page that fixes it, where another
 * provider is picked. It carries the connect card's frame (a card, an icon, a
 * title, one sentence, one button) so the two read as the same family.
 *
 * ONE SENTENCE PER SUBJECT, as whole keys: the pantry and the recipes each get
 * the sentence that is true of them, so a translator never has to reorder
 * English fragments.
 *
 * The link goes to `/settings/ai`, a page only an open instance has, and only
 * an open instance's stored provider can be a self-hosted server, so the card
 * cannot appear where that page redirects away.
 */
import { useTranslation } from 'react-i18next';
import { ServerOff } from 'lucide-react';

import { Link } from '#app/components/link';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';

/** Which screen is asking: each one has its own sentence. */
export type UnsupportedSubject = 'pantry' | 'recipes';

export function IntakeUnsupportedCard({ subject }: { subject: UnsupportedSubject }) {
  const { t } = useTranslation();
  return (
    <Card data-slot="intake-unsupported-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ServerOff className="h-5 w-5" aria-hidden="true" /> {t('intakeUnsupported.title')}
        </CardTitle>
        <CardDescription>
          {subject === 'pantry' ? t('intakeUnsupported.pantry') : t('intakeUnsupported.recipes')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="h-11 w-full sm:w-auto">
          <Link to="/settings/ai">{t('intakeUnsupported.choose')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
