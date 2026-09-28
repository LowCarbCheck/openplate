/**
 * `/admin/settings` — the one thing about this instance an administrator can
 * change without a redeploy (M234 spec 07).
 *
 * ── WHY A TAB OF ITS OWN ─────────────────────────────────────────────────
 *
 * Everything else in this console is about a PERSON: their allowance, their
 * standing, their invitation. This is about the instance, and it applies to
 * everybody on it in every language. Putting it on the people list would have
 * read as a property of whoever was on screen.
 *
 * ── THE CURRENT VALUE COMES FROM THE HANDSHAKE, not from a read ──────────
 *
 * `/health` already publishes `instance.nutrientReferenceBasis`, and this app
 * already reads `/health` once per tab, so the form draws its state from the
 * read the app was making anyway. There is no `GET /v1/admin/settings` to call
 * and this page must not invent one.
 *
 * That is also why the card says what it says about reloading: the answer this
 * page just changed is CACHED for the life of the tab, here and on everybody
 * else's device.
 *
 * ── Client-only, like every account screen ───────────────────────────────
 *
 * The layout's loader has already answered "does this instance have a server".
 * The write happens in the browser against that server, so this app's own
 * server never holds an administrator's token.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NotAnAdministratorCard } from '#app/components/admin/not-an-administrator';
import {
  InstanceSettingsCard,
  type InstanceSettingsState,
} from '#app/components/admin/instance-settings-card';
import { currentAdminClient } from '#app/lib/admin/admin-session';
import { useServerInstance } from '#app/hooks/use-server-instance';
import type { InstanceSettingsFormValues } from '#app/lib/admin/settings-schema';
import type { NutrientReferenceBasis } from '#app/lib/admin/admin-wire';

export default function AdminSettings() {
  const { t } = useTranslation();
  const instance = useServerInstance();
  const [state, setState] = useState<InstanceSettingsState>('form');
  const [failure, setFailure] = useState<string | null>(null);
  /** What the instance holds now: the handshake's answer until a save replaces it. */
  const [saved, setSaved] = useState<NutrientReferenceBasis | null>(null);
  const [forbidden, setForbidden] = useState(false);

  async function save(values: InstanceSettingsFormValues): Promise<void> {
    const client = currentAdminClient();
    if (client === null) {
      setForbidden(true);
      return;
    }
    setState('working');
    setFailure(null);
    try {
      const outcome = await client.patchSettings({ nutrientReferenceBasis: values.nutrientReferenceBasis });
      // A 403 IS A VALUE HERE, not a throw: a demoted or suspended
      // administrator gets the card, never a blank page.
      if (outcome.status === 'forbidden') {
        setForbidden(true);
        return;
      }
      setSaved(outcome.value.nutrientReferenceBasis);
      setState('saved');
    } catch {
      // Everything else is one sentence. A 400 means this build and the
      // service disagree about the three names, a 404 means the service is
      // older than the setting, and neither is something an administrator can
      // act on beyond trying again.
      setFailure(t('admin.settings.failed'));
      setState('form');
    }
  }

  if (forbidden) return <NotAnAdministratorCard />;

  // The handshake's answer, or the one this page has just written. `null` is a
  // service that publishes no basis, and the card draws no form for it.
  const basis = saved ?? instance?.nutrientReferenceBasis ?? null;

  return (
    <InstanceSettingsCard
      basis={basis}
      state={state}
      failure={failure}
      onSubmit={(values) => void save(values)}
    />
  );
}
