/**
 * "Paste your invite link": one box for an invite link that arrived as text
 * rather than as a navigation.
 *
 * Moved out of `routes/welcome.tsx` (M266 design, step 3) so the account door
 * on an invite-only `/` opens the same box behind its "I have an invite link"
 * door. Two screens, one implementation, and still none of the join ceremony.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { buildJoinFragment, isJoinLinkEmpty, parseJoinLinkInput } from '#app/lib/join-link';
import { trackInviteLinkPasted } from '#app/lib/matomo-events';

/**
 * One box for a link that arrived as text.
 *
 * It reimplements NOTHING of the join ceremony. What is pasted is parsed by
 * the one join-link grammar (`app/lib/join-link.ts`), rewritten as the same
 * fragment an opened link carries, and handed to `/join`, which then reads it
 * exactly as it reads a link somebody tapped.
 *
 * A DOCUMENT navigation rather than a router `navigate`: a client-side
 * navigation can be dropped, and this one carries the only copy of a
 * single-use capability. `assign` rather than `replace` so Back still returns
 * here from a link that turns out to be wrong.
 */
export function PasteInviteLink({ onCancel }: { onCancel: () => void }) {
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
    trackInviteLinkPasted();
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
