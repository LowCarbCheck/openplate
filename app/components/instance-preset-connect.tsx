/**
 * "This openplate provides its own AI" — the one-click connect for an
 * instance-provided inference endpoint (M138 spec 06).
 *
 * Renders NOTHING unless the operator configured `DEFAULT_INFERENCE_BASE_URL`
 * (`useInstanceInferencePreset` is the single gate, mirroring how every sync
 * surface funnels through `useSyncServerUrl`). On an ordinary instance this
 * component is invisible and costs the page one `undefined` read.
 *
 * Shared by the two AI-connection surfaces — the AI settings page and the scan
 * screen's keyless connect card — for the same reason `OAuthConnectButton` is:
 * a connect affordance that exists twice must be one component, or the two
 * drift into two different promises.
 *
 * PANEL, not a Card: both callers already own a Card, so this slots inside
 * theirs rather than nesting one.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '#app/components/ui/button';
import { useInstanceInferencePreset } from '#app/hooks/use-public-config';
import { buildPresetAiSettings } from '#app/lib/instance-preset';
import { putLocalAiSettings } from '#app/lib/local-store';
import { reportError } from '#app/lib/report-error';
import { cn } from '#app/lib/utils';
import { verifyProviderKey } from '#app/services/vision/verify-key';

interface InstancePresetConnectProps {
  /** Called after the settings row is written — callers re-read the device settings from here. */
  onConnected: () => void;
  className?: string;
}

export function InstancePresetConnect({ onConnected, className }: InstancePresetConnectProps) {
  const { t } = useTranslation();
  const preset = useInstanceInferencePreset();
  const [isConnecting, setIsConnecting] = useState(false);

  // No preset ⇒ no UI at all. Not a disabled button, not an empty panel.
  if (preset === null) return null;

  async function handleConnect(): Promise<void> {
    if (preset === null) return;
    setIsConnecting(true);
    try {
      await putLocalAiSettings(buildPresetAiSettings({ preset, now: Date.now() }));
    } catch (error) {
      reportError(error, { boundary: 'instance-preset-connect' });
      toast.error(t('settingsAi.preset.failed'));
      return;
    } finally {
      setIsConnecting(false);
    }

    // Tell the caller first: the connection IS saved at this point, and the
    // probe below is a courtesy. A slow or unreachable endpoint must never
    // leave the page looking like the connect didn't happen.
    onConnected();

    // Non-blocking reachability probe (`GET <baseUrl>/models`, the registry's
    // own check for this provider). `verifyProviderKey` never throws, so an
    // unreachable or key-refusing endpoint downgrades the toast rather than
    // undoing the save — the operator, not the user, is the one who can fix an
    // instance endpoint, and the user can still disconnect.
    const verification = await verifyProviderKey({
      provider: 'openai-compatible',
      apiKey: preset.apiKey ?? '',
      baseUrl: preset.baseUrl,
    });
    if (verification.status === 'ok') {
      toast.success(t('settingsAi.preset.connected'));
      return;
    }
    toast.warning(t('settingsAi.preset.connectedUnverified'));
  }

  return (
    <div className={cn('space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4', className)}>
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('settingsAi.preset.title')}</p>
        <p className="text-sm text-muted-foreground">{t('settingsAi.preset.body')}</p>
      </div>
      <Button type="button" className="h-11 w-full" disabled={isConnecting} onClick={() => void handleConnect()}>
        {isConnecting ? t('settingsAi.preset.connecting') : t('settingsAi.preset.connect')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('settingsAi.preset.byokStillAvailable')}</p>
    </div>
  );
}
