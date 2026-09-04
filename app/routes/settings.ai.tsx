import type { Route } from './+types/settings.ai';
import { useState } from 'react';
import { Form, useNavigate, useSearchParams } from 'react-router';
import { Link } from '#app/components/link';
import { Trans, useTranslation } from 'react-i18next';
// The singleton, not the hook: `clientAction` and the pure helpers it reaches
// run outside React, where `useTranslation` is unavailable. This route is
// client-only (the BYOK key never touches the server), so the singleton is
// always this browser's own instance — never one shared across requests.
import i18n from '#app/i18n/i18n';
import { toast } from 'sonner';
import { z } from 'zod';
import { getFormProps, getInputProps, useForm } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod/v4';
import type { SubmissionResult } from '@conform-to/react';
import type { AiProviderType } from '#types/enums';
import {
  deleteLocalAiSettings,
  getLocalAiSettings,
  getLocalMonthlyAiUsage,
  putLocalAiSettings,
} from '#app/lib/local-store';
import type { LocalAiSettings } from '#app/lib/local-store';
import { resolveSettingsReturnPath } from '#app/lib/settings-return';
import { syncNow } from '#app/lib/sync/sync-actions';
import { useInstanceInferencePreset } from '#app/hooks/use-public-config';
import { randomUuid } from '#app/lib/uuid';
import { formatSettingsUsageLine } from '#app/models/ai-usage';
import type { MonthlyAiUsage } from '#app/models/ai-usage';
import { findCatalogModel, getModelCatalog, getRecommendedModel } from '#app/services/vision/catalog';
import type { ModelOption } from '#app/services/vision/catalog';
import {
  PROVIDER_IDS,
  PROVIDER_REGISTRY,
  getProviderDefinition,
  getProvidersByPlacement,
  supportsOauthPkce,
} from '#app/services/vision/registry';
import { providersForDisplay, recommendedProviderFor } from '#app/models/ai-provider-recommendation';
import { verifyProviderKey } from '#app/services/vision/verify-key';
import type { KeyVerificationResult } from '#app/services/vision/verify-key';
import type { Toast } from '#app/utils/toast.server';
import { cn } from '#app/lib/utils';
import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { ConfirmAction } from '#app/components/confirm-action';
import { OAuthConnectButton } from '#app/components/oauth-connect-button';
import { InstancePresetConnect } from '#app/components/instance-preset-connect';
import { SubmitButton } from '#app/components/submit-button';
import { FieldError } from '#app/components/field-error';
import { Button } from '#app/components/ui/button';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { Badge } from '#app/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '#app/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#app/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';

export { RouteErrorBoundary as ErrorBoundary };

// Title via the pure `meta-title` seam, with the language read off the ROOT
// loader through `matches` — never the i18next singleton (see `meta-title.ts`
// for why that would leak one visitor's language into another's <title>).
export const meta: Route.MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.ai') }];

export const handle = {
  title: 'AI Settings',
  titleKey: 'settingsAi.title',
  backTo: '/settings',
};

/**
 * The narrow slice of i18next's `t` this route's pure helpers depend on —
 * threaded in explicitly so each stays directly callable from a test with a
 * stub translator, never carrying a hidden global dependency.
 */
export type Translate = (key: string, params?: Readonly<Record<string, string | number | boolean | Date>>) => string;

/** `t` for the non-React paths (`clientAction` and the schema it parses with). */
const translate: Translate = (key, params) => i18n.t(key, params ?? {});

/**
 * A provider's display name, resolved through the registry's `labelKey` — the
 * one source of truth for what a provider is called, shared with the profile
 * page. It is a CATALOG KEY rather than a literal because one of the names
 * ("Self-hosted / local endpoint") is copy rather than a brand and has to
 * translate.
 *
 * Falls back to the raw id for a provider this build doesn't know: that only
 * happens for a settings row written by a newer image, which `clientLoader`
 * below already degrades to "not connected" — this is the belt to that braces,
 * so an unrecognised value can never blank the page.
 */
function providerLabel({ provider, t }: { provider: string; t: Translate }): string {
  const definition = getProviderDefinition(provider);
  return definition ? t(definition.labelKey) : provider;
}

/**
 * Shown while the client loader reads the on-device BYOK settings (M117/02).
 * This route has no server `loader` at all — the key/provider/model live only
 * in the local store, so there is nothing meaningful a server render could
 * show; React Router requires this fallback for any route whose data comes
 * solely from a `clientLoader`.
 */
export function HydrateFallback() {
  const { t } = useTranslation();
  return (
    <output className="mx-auto block max-w-2xl py-16 text-center text-sm text-muted-foreground" aria-live="polite">
      {t('settingsAi.loading')}
    </output>
  );
}

/**
 * Providers tucked behind the "Advanced" panel — free-text model, no curated
 * picker. Registry data (`placement`), not a second hand-kept list.
 */
const ADVANCED_PROVIDER_DEFINITIONS = getProvidersByPlacement('advanced');

/**
 * Longer, descriptive option copy for the Advanced radio list — deliberately
 * distinct from the registry's short `labelKey`: a picker has to explain the
 * choice, a status badge doesn't. Falls back to the display name for a
 * provider with no bespoke option copy.
 */
const ADVANCED_OPTION_KEYS = {
  'openai-compatible': 'settingsAi.advanced.openaiCompatibleOption',
  anthropic: 'settingsAi.advanced.anthropicOption',
  openrouter: undefined,
  mistral: undefined,
  // NEVER RENDERED. `managed` has no tab, no card and no key field on this
  // page (`placement: 'derived'` in the registry) — its endpoint, model and
  // bearer all come from the open session. The entry exists because the map is
  // total over `AiProviderType`, and a total map is what stops a new provider
  // shipping with a silently missing label.
  managed: undefined,
} satisfies Record<AiProviderType, string | undefined>;

/**
 * One line of "why you'd pick this one" under the provider tabs. Optional by
 * design: a provider without an entry simply shows no blurb, which is the
 * right answer for the ones behind "Advanced" — someone who opens that panel
 * already knows what they came for.
 *
 * These are FACTS ABOUT THE PROVIDER, never a promise openplate makes on the
 * user's behalf. Mistral's German blurb in particular states EU hosting and a
 * card-free free tier as things that are true of Mistral — it is not, and must
 * never become, a data-protection guarantee from openplate.
 */
const PROVIDER_BLURB_KEYS = {
  openrouter: 'settingsAi.providerBlurb.openrouter',
  mistral: 'settingsAi.providerBlurb.mistral',
  'openai-compatible': undefined,
  anthropic: undefined,
  managed: undefined,
} satisfies Record<AiProviderType, string | undefined>;

/** Only meaningful where the model is free text — a provider with a curated picker never shows it. */
const MODEL_PLACEHOLDER = {
  'openai-compatible': 'llama3',
  anthropic: 'claude-sonnet-5',
  openrouter: undefined,
  mistral: undefined,
  // NEVER RENDERED. `managed` has no tab, no card and no key field on this
  // page (`placement: 'derived'` in the registry) — its endpoint, model and
  // bearer all come from the open session. The entry exists because the map is
  // total over `AiProviderType`, and a total map is what stops a new provider
  // shipping with a silently missing label.
  managed: undefined,
} satisfies Record<AiProviderType, string | undefined>;

/**
 * Rough per-scan cost, in cents a person can picture — never a $/1M-token
 * price. This is NOT the same as `estimateScanCostUsd` in
 * `#app/services/vision/cost` (which uses REAL token counts from a completed
 * scan) — before any scan has happened, this picker just needs a plain-money
 * ballpark. The token counts below are a deliberately generous round-number
 * assumption (a plate photo plus a short JSON macro response), not a
 * provider-verified figure — they exist purely to turn catalog pricing into
 * an honest "about N¢ a photo" line.
 */
const TYPICAL_SCAN_INPUT_TOKENS = 1500;
const TYPICAL_SCAN_OUTPUT_TOKENS = 300;
const TOKENS_PER_MILLION = 1_000_000;

/** "under a cent a photo" / "about 2¢ a photo" — rounds up, so it's never an undersell. */
export function describeApproxScanCost({
  model,
  t,
}: {
  model: Pick<ModelOption, 'inPerM' | 'outPerM'>;
  t: Translate;
}): string {
  const usd =
    (TYPICAL_SCAN_INPUT_TOKENS * model.inPerM) / TOKENS_PER_MILLION +
    (TYPICAL_SCAN_OUTPUT_TOKENS * model.outPerM) / TOKENS_PER_MILLION;
  if (usd < 0.01) return t('settingsAi.cost.underCent');
  return t('settingsAi.cost.approxCents', { cents: Math.ceil(usd * 100) });
}

/**
 * Blurb key for a catalog model. Derived from the model id rather than kept as
 * a second hand-maintained list, so adding a model to the catalog can't leave a
 * blurb silently pointing at the wrong entry — a missing catalog key shows up
 * as the visible key instead.
 */
export function modelBlurbKey(modelId: string): string {
  return `settingsAi.model.blurb.${modelId.replace(/[^a-z0-9]+/gi, '-')}`;
}

/** Provider-aware label + placeholder for the API-key field. */
const API_KEY_LABEL_KEYS = {
  openrouter: 'settingsAi.apiKey.label.openrouter',
  mistral: 'settingsAi.apiKey.label.mistral',
  'openai-compatible': 'settingsAi.apiKey.label.openaiCompatible',
  anthropic: 'settingsAi.apiKey.label.anthropic',
  // Never rendered — `managed` has no key field. See `ADVANCED_OPTION_KEYS`.
  managed: 'settingsAi.apiKey.label.openaiCompatible',
} satisfies Record<AiProviderType, string>;

/**
 * A KEY-SHAPE hint, not copy — never translated, so every entry has to be a
 * literal prefix the provider really issues. Mistral's console hands out a
 * bare random string with no distinguishing prefix, so it gets an empty
 * placeholder (rendered as none at all, see below) rather than an invented
 * one that would teach the wrong shape.
 */
const API_KEY_PLACEHOLDERS = {
  openrouter: 'sk-or-v1-...',
  mistral: '',
  'openai-compatible': 'sk-...',
  anthropic: 'sk-ant-...',
  managed: '',
} satisfies Record<AiProviderType, string>;

/** Placeholder base URL — a local Ollama-style endpoint, which the CSP's localhost carve-out always allows. */
const OPENAI_COMPATIBLE_BASE_URL_PLACEHOLDER = 'http://localhost:11434/v1';

/**
 * Explains the CSP's localhost-only default for a self-hosted/local endpoint
 * (M117/02 review fix): the production content-security policy only allows
 * `localhost`/`127.0.0.1` for a custom base URL — a remote endpoint needs the
 * operator to set `CSP_CONNECT_EXTRA` (see the README's self-hosting docs).
 */
const OPENAI_COMPATIBLE_BASE_URL_HELP_KEY = 'settingsAi.baseUrl.help';

/**
 * Built per-call rather than at module scope: every message is user-facing
 * copy, so the schema can only exist once a translator does.
 */
export function createAiSettingsSchema(t: Translate) {
  return (
    z
      .object({
        provider: z.enum(PROVIDER_IDS),
        model: z.string().min(1, t('settingsAi.errors.modelRequired')),
        baseUrl: z
          .string()
          .optional()
          .transform((value) => (value?.trim() ? value.trim() : undefined))
          .refine((value) => value === undefined || /^https?:\/\//.test(value), t('settingsAi.errors.baseUrlScheme')),
        apiKey: z.string().optional(),
      })
      // Cross-field: openai-compatible has no fixed endpoint, so a base URL is
      // mandatory — the CSP's connect-src can't allowlist an arbitrary one
      // (settings are client-only since M117/02, so there's no server-side
      // per-user CSP to compute), and an unset base URL used to silently fall
      // back to api.openai.com, which the browser can never reach anyway.
      .refine((data) => data.provider !== 'openai-compatible' || data.baseUrl !== undefined, {
        message: t('settingsAi.errors.baseUrlRequired'),
        path: ['baseUrl'],
      })
  );
}

type AiSettingsSubmission = z.infer<ReturnType<typeof createAiSettingsSchema>>;

/**
 * Client-only read: the BYOK settings and this month's usage both live
 * entirely in the local store since M117/02 — there is no server `loader` for
 * this route (see `HydrateFallback` above for why `hydrate` must be true).
 */
export async function clientLoader(): Promise<{ settings: LocalAiSettings | null; monthlyUsage: MonthlyAiUsage }> {
  const [settings, monthlyUsage] = await Promise.all([getLocalAiSettings(), getLocalMonthlyAiUsage()]);
  // THE degradation point for an unrecognised stored provider (M130/01). The
  // settings row is an opaque JSON blob with no schema behind it, so an
  // instance rolled back one image can read a provider it has never heard of
  // — from a user who connected it minutes ago on the newer build. Treat that
  // as "not connected" (the page then offers reconnecting, and a save
  // overwrites the row) rather than letting a registry lookup throw a
  // TypeError deep in render and blank the page.
  const isKnownProvider = settings !== null && getProviderDefinition(settings.provider) !== undefined;
  return { settings: isKnownProvider ? settings : null, monthlyUsage };
}
clientLoader.hydrate = true as const;

/**
 * Skips the live provider check when the user only changed the model and
 * left the key field blank on an already-configured account — there's
 * nothing new to verify. Otherwise performs the live key check.
 */
async function verifyKeyUnlessModelOnlyChange({
  data,
  hasExistingSettings,
}: {
  data: AiSettingsSubmission;
  hasExistingSettings: boolean;
}): Promise<KeyVerificationResult> {
  const isModelOnlyChange = !data.apiKey && hasExistingSettings;
  if (isModelOnlyChange) {
    return { status: 'ok' };
  }

  const apiKey = data.apiKey;
  if (!apiKey) {
    throw new Error('Expected an API key to verify — first-time setup should have already been rejected.');
  }

  return verifyProviderKey({ provider: data.provider, apiKey, baseUrl: data.baseUrl ?? null });
}

/**
 * The "saved, but couldn't verify" toast text (M117/02 review fix). For a
 * provider the USER supplies the endpoint for (`baseUrl: null` in the
 * registry — self-hosted / local today), an unreachable verify call is very
 * often the content-security policy blocking a non-localhost base URL (or the
 * endpoint not allowing browser CORS) rather than a generic network blip —
 * say so, since the generic message left self-hosters guessing. Read off the
 * registry rather than a provider literal: that hint is true of any
 * bring-your-own-endpoint provider, and false of every fixed-endpoint one.
 */
function buildUnverifiedSaveMessage({ provider, t }: { provider: AiProviderType; t: Translate }): string {
  if (PROVIDER_REGISTRY[provider].baseUrl === null) {
    return t('settingsAi.toast.unverifiedOpenaiCompatible');
  }
  return t('settingsAi.toast.unverified');
}

/**
 * Disconnect only — the only mutation this route routes through the router's
 * client-action mechanism (`ConfirmAction` always submits to it). The main
 * save form is handled entirely inside the component's own `onSubmit` (see
 * below) since it needs the live-verify step interleaved with local-store
 * writes in a way Conform's action-round-trip model doesn't fit.
 */
export async function clientAction({ request }: Route.ClientActionArgs): Promise<Toast> {
  const formData = await request.formData();
  if (formData.get('_intent') !== 'delete') {
    return { id: randomUuid(), type: 'message', description: translate('settingsAi.toast.nothingToDisconnect') };
  }
  await deleteLocalAiSettings();
  // NO TOMBSTONE ANY MORE (M192). A disconnect used to also write a stamped
  // `gatewayConnection: 'disconnected'` row, because the settings row it
  // deleted was synced across the account's devices and an absence carries no
  // `updatedAt` to merge on. That whole entity is gone: BYOK settings are
  // device-local again, and a managed instance's AI is derived from the
  // session rather than stored, so there is nothing here for another device to
  // hand back.
  void syncNow().catch(() => undefined);
  return { id: randomUuid(), type: 'success', description: translate('settingsAi.toast.disconnected') };
}

function ModelRadioCard({
  model,
  isSelected,
  onSelect,
}: {
  model: ModelOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <label
      // The radio's own name: the vendor/blurb/cost lines stay on screen but
      // would otherwise be read out in full for every option in the list.
      aria-label={model.label}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent/50',
        isSelected && 'border-primary bg-accent/40',
      )}
    >
      <input
        type="radio"
        name="catalogModelChoice"
        value={model.id}
        className="mt-1"
        checked={isSelected}
        onChange={onSelect}
      />
      <span className="flex-1 space-y-0.5">
        <span className="flex items-center gap-2 font-medium">
          {model.label}
          {model.recommended && <Badge variant="secondary">{t('settingsAi.model.recommended')}</Badge>}
        </span>
        <span className="block text-xs text-muted-foreground">
          {model.vendor} — {t(modelBlurbKey(model.id))}
        </span>
        <span className="block text-xs text-muted-foreground">{describeApproxScanCost({ model, t })}</span>
      </span>
    </label>
  );
}

/**
 * The curated model picker, driven by whatever the catalog holds for the
 * active provider (M130/04) — not by which provider it is. It renders for
 * every provider with a non-empty catalog (openrouter, mistral, anthropic
 * today); a provider with an empty one (a self-hosted endpoint, whose pricing
 * is unknowable) keeps the free-text model field instead. The custom-model
 * escape hatch at the bottom stays available either way.
 *
 * The "get a key" deep link is the registry's `keyConsoleUrl`, so a new
 * provider brings its own console URL with it and this component needs no
 * edit — and no provider's URL is hardcoded in JSX any more.
 */
function CatalogModelSection({
  provider,
  catalogModelId,
  customModelId,
  onSelectCatalogModel,
  onCustomModelChange,
}: {
  provider: AiProviderType;
  catalogModelId: string;
  customModelId: string;
  onSelectCatalogModel: (id: string) => void;
  onCustomModelChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const hasCustomOverride = customModelId.trim().length > 0;
  const definition = PROVIDER_REGISTRY[provider];
  const catalog = getModelCatalog(provider);
  // The custom-model example is the provider's OWN first catalog id, so an
  // OpenRouter reader sees a namespaced `vendor/model` and a Mistral one sees
  // the bare id that provider's API actually accepts — no per-provider branch,
  // and no id from one namespace teaching the wrong shape in another. A
  // provider with an empty catalog (a self-hosted endpoint) has no id to show,
  // so it gets a described placeholder rather than an invented one.
  const customPlaceholder =
    catalog[0] ?
      t('settingsAi.model.customPlaceholder', { example: catalog[0].id })
    : t('settingsAi.model.customPlaceholderGeneric');

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {t('settingsAi.model.pickIntro')}
        {definition.keyConsoleUrl && (
          <>
            {' '}
            <a
              href={definition.keyConsoleUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {t('settingsAi.model.createKeyLink', { provider: t(definition.labelKey) })}
            </a>
            .
          </>
        )}
      </p>

      <div className="space-y-2">
        {catalog.map((model) => (
          <ModelRadioCard
            key={model.id}
            model={model}
            isSelected={!hasCustomOverride && catalogModelId === model.id}
            onSelect={() => onSelectCatalogModel(model.id)}
          />
        ))}
      </div>

      <Collapsible defaultOpen={hasCustomOverride}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <ChevronDown className="h-3.5 w-3.5" /> {t('settingsAi.model.customToggle')}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-1">
          <Input
            value={customModelId}
            onChange={(event) => onCustomModelChange(event.target.value)}
            placeholder={customPlaceholder}
          />
          <p className="text-xs text-muted-foreground">{t('settingsAi.model.customHint')}</p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * Disconnect confirmation copy (spec 03): this button only clears the
 * device-local key via `deleteLocalAiSettings` — openplate never holds
 * management credentials for any provider, so there is nothing server-side
 * to revoke. An OAUTH-ISSUED key in particular keeps working (and keeps
 * spending against its account-level credit limit) at the provider until the
 * user revokes it there themselves — the warning line below and its link are
 * the whole point of this dialog, not an afterthought, so they come first
 * rather than trailing the description.
 *
 * That extra line is gated on `supportsOauthPkce` and links the registry's
 * `keyConsoleUrl` (M130/04): it is true of any key OUR connect flow minted,
 * and false for a key the user pasted in by hand — which is the actual
 * distinction, not "is this OpenRouter".
 */
function DisconnectDialogDescription({ settings }: { settings: LocalAiSettings }) {
  const { t } = useTranslation();
  const provider = settings.provider;
  const definition = PROVIDER_REGISTRY[provider];

  // An instance-preset connection (M138 spec 06) has no provider account behind
  // it and nothing to revoke anywhere — the "this doesn't revoke your key at
  // <provider>" warning below would be actively confusing, since the person
  // reading it never got a key from anyone. Its own note explains the real
  // consequence instead: reconnecting is one tap, because the instance still
  // offers its AI.
  if (settings.connectedVia === 'preset') {
    return (
      <span className="block space-y-2">
        <span className="block">{t('settingsAi.disconnect.stops')}</span>
        <span className="block rounded-md border border-accent-amber-border bg-accent-amber-surface p-2 text-accent-amber">
          {t('settingsAi.preset.disconnectNote')}
        </span>
      </span>
    );
  }

  const showOauthKeyNote = supportsOauthPkce(provider) && definition.keyConsoleUrl !== null;
  return (
    <span className="block space-y-2">
      <span className="block">{t('settingsAi.disconnect.stops')}</span>
      <span className="block rounded-md border border-accent-amber-border bg-accent-amber-surface p-2 text-accent-amber">
        <Trans
          i18nKey="settingsAi.disconnect.notRevoked"
          values={{ provider: providerLabel({ provider, t }) }}
          components={{ strong: <span className="font-medium" /> }}
        />{' '}
        {showOauthKeyNote && (
          <Trans
            i18nKey="settingsAi.disconnect.oauthKeyStillThere"
            values={{ provider: providerLabel({ provider, t }) }}
            components={{
              keyLink: (
                <a
                  href={definition.keyConsoleUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline underline-offset-4"
                >
                  {/* Link text comes from the `keyLink` tag inside the translated string. */}
                </a>
              ),
            }}
          />
        )}
      </span>
    </span>
  );
}

/**
 * Connected-state header: a tinted status row confirming the live provider +
 * model, with the only key-related action (Disconnect) inline. Its own `Form`
 * carries the `_intent=delete` mutation — kept a sibling of the settings form,
 * never nested, so the two POST targets stay independent.
 */
function ConnectedPanel({ settings, onDisconnected }: { settings: LocalAiSettings; onDisconnected: () => void }) {
  const { t } = useTranslation();
  const modelLabel = findCatalogModel(settings.provider, settings.model)?.label ?? settings.model;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
          <span>
            <Trans
              i18nKey="settingsAi.connected.status"
              values={{ provider: providerLabel({ provider: settings.provider, t }), model: modelLabel }}
              components={{ strong: <span className="font-medium" /> }}
            />
          </span>
          {/* Which of the three ways this connection came about only ever shows
            up for the preset (M138 spec 06): "openai-compatible + a base URL
            you never typed" is otherwise indistinguishable from a manual
            self-hosted connect, and the disconnect dialog's copy differs. */}
          {settings.connectedVia === 'preset' && <Badge variant="secondary">{t('settingsAi.preset.badge')}</Badge>}
        </div>
        <ConfirmAction
          trigger={
            <Button type="button" variant="destructive" size="sm">
              {t('settingsAi.disconnect.button')}
            </Button>
          }
          title={t('settingsAi.disconnect.title')}
          description={<DisconnectDialogDescription settings={settings} />}
          confirmText={t('settingsAi.disconnect.button')}
          confirmVariant="destructive"
          formData={{ _intent: 'delete' }}
          onSuccess={onDisconnected}
        />
      </div>
    </div>
  );
}

/**
 * The zero-data opener: three numbered steps, one short sentence each, shown
 * above everything else while nothing is connected. It answers "what do I
 * actually DO here" before the page asks for anything — the four-paragraph
 * `NotConnectedExplainer` below still answers "why / what does it cost / what
 * happens to my photo", but as reference material at the bottom rather than
 * as the first thing a first-time visitor has to read.
 *
 * Deliberately carries NO privacy/cost sub-clauses: every one of them already
 * has a home in the explainer, and repeating them here would turn three
 * scannable lines back into a wall of text.
 *
 * Same registry-driven shape as the explainer's setup paragraph: the named
 * provider and the console link both come off whichever definition is
 * recommended for this UI language, so the steps can never send a German
 * reader to a provider the tab row below doesn't badge as "Empfohlen".
 */
function QuickstartCard({ recommendedProvider }: { recommendedProvider: AiProviderType }) {
  const { t } = useTranslation();
  const recommendedDefinition = PROVIDER_REGISTRY[recommendedProvider];
  const providerName = t(recommendedDefinition.labelKey);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settingsAi.quickstart.title')}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <ol className="list-decimal space-y-1 pl-5">
          <li>{t('settingsAi.quickstart.step1', { provider: providerName })}</li>
          <li>
            <Trans
              i18nKey="settingsAi.quickstart.step2"
              values={{ provider: providerName }}
              components={{
                providerLink: (
                  <a
                    href={recommendedDefinition.keyConsoleUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-4"
                  >
                    {/* Link text comes from the `providerLink` tag inside the translated string. */}
                  </a>
                ),
              }}
            />
          </li>
          <li>{t('settingsAi.quickstart.step3')}</li>
        </ol>
      </CardContent>
    </Card>
  );
}

/**
 * Reference explainer, shown BELOW the form only before a provider is
 * connected: whether this is even worth doing (first sentence, so a visitor
 * who doesn't want it can stop reading right there), what you need to go get
 * and what it costs in real money, what happens to your photo, and that
 * setup is a one-time, ~2-minute job. Warm but not salesy (DESIGN.md tone),
 * text-sm, no new colors.
 *
 * Takes the recommended provider as a prop (M130/04) rather than assuming
 * OpenRouter: which provider the page puts first is locale-dependent now, and
 * the setup paragraph has to name the same one the tab row badges.
 */
function NotConnectedExplainer({
  recommendedProvider,
  hasInstancePreset,
}: {
  recommendedProvider: AiProviderType;
  hasInstancePreset: boolean;
}) {
  const { t } = useTranslation();
  const recommendedDefinition = PROVIDER_REGISTRY[recommendedProvider];
  // Each paragraph is ONE catalog entry rather than a chain of sentence
  // fragments: a translator needs the whole sentence to reorder it, and the
  // emphasis/link positions differ per language. `<Trans>` carries the inline
  // markup; the components map below names each slot.
  const emphasis = { strong: <span className="text-foreground" /> };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settingsAi.explainer.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        {/* Everything below this line is written for a visitor who has to go get
            their own provider key — including the sentence "openplate doesn't
            run its own AI", which is simply FALSE on an instance whose operator
            wired one up (M138 spec 06). Rather than fork four paragraphs, say
            so once, first: the preset panel above is the short path, and the
            rest of this card is what to do if you'd rather bring your own. */}
        {hasInstancePreset && <p>{t('settingsAi.preset.explainerNote')}</p>}
        <p>
          <Trans i18nKey="settingsAi.explainer.notRequired" components={emphasis} />
        </p>
        <p>
          <Trans i18nKey="settingsAi.explainer.byok" components={emphasis} />
        </p>
        <p>
          <Trans
            i18nKey="settingsAi.explainer.photosAndCost"
            components={{
              ...emphasis,
              dataLink: <Link to="/settings/data" className="text-primary underline underline-offset-4" />,
            }}
          />
        </p>
        <p>
          <Trans
            i18nKey="settingsAi.explainer.setup"
            values={{ provider: t(recommendedDefinition.labelKey) }}
            components={{
              // Name AND URL both come off the registry entry for whichever
              // provider is recommended for this UI language — the paragraph
              // must not send a German reader to OpenRouter while the tab row
              // above badges Mistral as "Empfohlen".
              providerLink: (
                <a
                  href={recommendedDefinition.keyConsoleUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-4"
                >
                  {/* Link text comes from the `providerLink` tag inside the translated string. */}
                </a>
              ),
            }}
          />
        </p>
        {/* The one genuinely OpenRouter-specific fact the old setup sentence
            carried, kept as its own paragraph: it is a statement about how
            OpenAI's API behaves, not a recommendation, so it stays true
            whichever provider is recommended above. */}
        <p>
          <Trans i18nKey="settingsAi.explainer.setupOpenAiNote" components={emphasis} />
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Always-visible, plain-language "what do I do if it doesn't work" reference
 * — shown whether or not a provider is connected yet, since the questions it
 * answers are as relevant mid-setup as they are after months of scanning.
 */
function ScanTroubleshootingCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settingsAi.troubleshooting.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>{t('settingsAi.troubleshooting.intro')}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('settingsAi.troubleshooting.credit')}</li>
          <li>{t('settingsAi.troubleshooting.keyTypo')}</li>
          <li>{t('settingsAi.troubleshooting.providerDown')}</li>
        </ul>
        <p>{t('settingsAi.troubleshooting.reassurance')}</p>
      </CardContent>
    </Card>
  );
}

export default function SettingsAi({ loaderData }: Route.ComponentProps) {
  const { monthlyUsage } = loaderData;
  const { t, i18n: i18nInstance } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // `null` on every instance whose operator set no `DEFAULT_INFERENCE_BASE_URL`
  // — which is the default, and means this page renders exactly as it did
  // before M138 spec 06.
  const instancePreset = useInstanceInferencePreset();
  // Where a successful connect returns the user (`?next=diary|scan|add`) — a
  // TOKEN, resolved through the allowlist below, never a raw path.
  const nextToken = searchParams.get('next');
  const [settings, setSettings] = useState<LocalAiSettings | null>(loaderData.settings);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<SubmissionResult<string[]> | undefined>(undefined);
  const settingsUsageLine = formatSettingsUsageLine({ usage: monthlyUsage, t });

  /**
   * Re-reads the device settings after a write this component didn't make
   * itself — today only the instance-preset connect (M138 spec 06), which saves
   * through the same `putLocalAiSettings` path the form below uses. Reading the
   * store back rather than trusting a passed-up object keeps ONE source of truth
   * for what is connected.
   */
  const refreshSettings = (): void => {
    void getLocalAiSettings().then(setSettings);
  };

  // PRESENTATION ONLY (M130/04). The UI language decides which provider tab
  // comes first and carries the "Recommended" badge — and nothing else. It
  // never reaches storage, validation, dispatch, or a provider that is already
  // connected: below, `initialProvider` prefers the STORED provider and only
  // falls back to the recommendation for a device with no settings at all.
  const uiLanguage = i18nInstance.language;
  const recommendedProvider = recommendedProviderFor(uiLanguage);
  const primaryProviderDefinitions = providersForDisplay({ placement: 'primary', language: uiLanguage });

  const initialProvider: AiProviderType = settings?.provider ?? recommendedProvider;
  // Provider-scoped, both of them: a model id only means something inside one
  // provider's namespace (M130/02), so the catalog match and the recommended
  // default are looked up under the provider actually in play — never
  // OpenRouter's on someone else's behalf.
  const initialCatalogMatch = findCatalogModel(initialProvider, settings?.model ?? '');
  const initialRecommendedModel = getRecommendedModel(initialProvider);
  const initialHasCatalog = getModelCatalog(initialProvider).length > 0;

  // Tracked separately from Conform's (uncontrolled) field metadata so the
  // provider tabs, model picker, and custom-model escape hatch can all react
  // live to each other; the actual submitted `provider`/`model` values are
  // carried by controlled hidden inputs (see below) that mirror this state.
  const [selectedProvider, setSelectedProvider] = useState<AiProviderType>(initialProvider);
  const [catalogModelId, setCatalogModelId] = useState<string>(
    initialCatalogMatch?.id ?? initialRecommendedModel?.id ?? '',
  );
  const [customModelId, setCustomModelId] = useState<string>(
    initialHasCatalog && settings?.model && !initialCatalogMatch ? settings.model : '',
  );
  // Controls the "Advanced: use a different provider" Collapsible below.
  // Starts open only when the stored/initial provider already needs it —
  // registry `placement`, not a provider literal; the panel is also
  // force-opened whenever a validation error lands on a field hidden inside it
  // — see `hasHiddenAdvancedFieldError` further down, which is OR'd into the
  // `Collapsible`'s `open` prop.
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(
    PROVIDER_REGISTRY[initialProvider].placement === 'advanced',
  );
  // Open by default during setup, for every provider. It used to start
  // collapsed wherever one-click OAuth was available, which left a first-time
  // visitor on the recommended tab looking at a single button and a link —
  // the quickstart's step 3 ("paste it below") pointed at nothing visible.
  // The OAuth button still sits ABOVE this panel and still reads as the first
  // move; the key fields simply wait open underneath.
  //
  // Unconditional `true` rather than `!isConnected`: the whole panel only
  // renders while disconnected, so the initial value is only ever read in
  // that state — and this way it is open again after a disconnect too,
  // without an effect to reset it. Switching provider tabs doesn't touch it
  // (`selectProvider` leaves it alone), so it stays open across a tab switch.
  const [isManualEntryOpen, setIsManualEntryOpen] = useState<boolean>(true);

  const effectiveCatalogModel = customModelId.trim() || catalogModelId;

  // When connected, the provider is locked to the stored settings: the badge and
  // hidden input mirror `settings.provider`, and no control can change it. When
  // not connected, the local `selectedProvider` state drives everything.
  const isConnected = settings !== null;
  const providerValue: AiProviderType = settings ? settings.provider : selectedProvider;
  // THE replacement for the three "is the active provider OpenRouter" literal
  // checks this page used to gate its model UI on. The question it was really
  // asking all along: does this provider have curated models?
  const hasCatalog = getModelCatalog(providerValue).length > 0;
  const selectedProviderBlurbKey = PROVIDER_BLURB_KEYS[selectedProvider];

  /**
   * Switching providers before anything is connected. Resets the model state
   * to the NEW provider's recommendation rather than carrying the old one
   * across: model ids are provider-scoped, so an OpenRouter id left selected
   * on the Mistral tab would be a model Mistral has never heard of.
   */
  const selectProvider = (next: AiProviderType) => {
    setSelectedProvider(next);
    setCatalogModelId(getRecommendedModel(next)?.id ?? '');
    setCustomModelId('');
  };

  const aiSettingsSchema = createAiSettingsSchema(t);

  const [form, fields] = useForm({
    id: 'ai-settings',
    lastResult,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: aiSettingsSchema });
    },
    defaultValue: {
      provider: initialProvider,
      model: settings?.model ?? '',
      baseUrl: settings?.baseUrl ?? '',
    },
    // Fully client-driven: the key never leaves this device, so saving is a
    // local-store write, not a server round trip. `onSubmit` intercepts the
    // native submission; `lastResult`/`setSettings` below are local component
    // state standing in for the old server action's `actionData`/redirect.
    async onSubmit(event, { formData }) {
      event.preventDefault();
      const submission = parseWithZod(formData, { schema: aiSettingsSchema });
      if (submission.status !== 'success') {
        // Defensive fallback only — Conform's own submit handling
        // (`@conform-to/react`'s `context.submit`) intercepts an invalid
        // submission and calls `event.preventDefault()` itself *before* ever
        // invoking this `onSubmit` callback, so in practice this branch is
        // never reached for a real validation failure; `fields.*.errors`
        // (and the `hasHiddenAdvancedFieldError` check that auto-opens the
        // Advanced panel below) come from Conform's own live field state,
        // not from here. Kept for defensiveness in case a future Conform
        // version's gating changes.
        setLastResult(submission.reply());
        return;
      }

      const data = submission.value;
      if (!data.apiKey && !settings) {
        setLastResult(submission.reply({ fieldErrors: { apiKey: [t('settingsAi.errors.apiKeyRequiredFirstTime')] } }));
        return;
      }
      if (settings && !data.apiKey && data.provider !== settings.provider) {
        setLastResult(submission.reply({ formErrors: [t('settingsAi.errors.disconnectToSwitch')] }));
        return;
      }

      setIsSubmitting(true);
      try {
        const verification = await verifyKeyUnlessModelOnlyChange({ data, hasExistingSettings: Boolean(settings) });
        if (verification.status === 'rejected') {
          setLastResult(submission.reply({ formErrors: [t('settingsAi.errors.keyRejected')] }));
          return;
        }

        const apiKey = data.apiKey || settings?.apiKey;
        if (!apiKey) {
          setLastResult(submission.reply({ formErrors: [t('settingsAi.errors.apiKeyRequired')] }));
          return;
        }

        // Captured before `setSettings` so it reflects the state BEFORE this
        // save — true only when no provider was configured yet.
        const wasFirstConnect = settings === null;
        const saved = await putLocalAiSettings({
          provider: data.provider,
          baseUrl: data.baseUrl ?? null,
          model: data.model,
          apiKey,
          // A fresh key typed into THIS form is always manual entry; a
          // model-only re-save (no new key, reusing `settings.apiKey`) keeps
          // whatever method originally provisioned the key — e.g. an
          // OAuth-connected key stays 'oauth' when only the model changes.
          connectedVia: data.apiKey ? 'manual' : (settings?.connectedVia ?? 'manual'),
          updatedAt: Date.now(),
        });
        setSettings(saved);
        setLastResult(undefined);

        // A "saved but couldn't verify" result stays on the page (the user may
        // need to fix a CSP/CORS issue) — it never sweeps them onward.
        if (verification.status === 'unverified') {
          toast.success(buildUnverifiedSaveMessage({ provider: data.provider, t }));
          return;
        }

        toast.success(t('settingsAi.toast.saved'));
        // On a verified save: return to the caller's `?next=` target, or the
        // diary on a first connect. A re-save with no return token stays put.
        const destination = resolveSettingsReturnPath(nextToken) ?? (wasFirstConnect ? '/diary' : null);
        if (destination !== null) void navigate(destination);
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  const savingLabel = isConnected ? t('settingsAi.save.savingModel') : t('settingsAi.save.verifyingAndSaving');
  const idleLabel = isConnected ? t('settingsAi.save.model') : t('settingsAi.save.settings');

  // The model/baseUrl inputs for an advanced (non-OpenRouter) provider stay
  // mounted-but-hidden (`forceMount`) while the "Advanced" panel is
  // collapsed, so a validation error landing on one of them (most commonly
  // the cross-field "base URL required for self-hosted" rule, or a blank
  // model) is invisible and a failed save looks like it silently did nothing
  // (M117/02 review fix, take two — Conform intercepts an invalid submit
  // before `onSubmit` above ever runs, so this has to be derived from
  // Conform's own live field state on every render, not from a post-submit
  // hook). Forces the panel open for as long as the error exists; it
  // self-clears (and the panel becomes collapsible again) once the user
  // fixes the field, since Conform revalidates on input.
  const hasHiddenAdvancedFieldError =
    !isConnected && ((fields.model.errors?.length ?? 0) > 0 || (fields.baseUrl.errors?.length ?? 0) > 0);

  // Same forced-open reasoning as `hasHiddenAdvancedFieldError`, one level up:
  // the manual-entry panel below (which now wraps BOTH the advanced-provider
  // switch and the API-key field) must never hide a validation error the user
  // can't see a reason for — this additionally covers `apiKey`, the one field
  // that lives directly inside the new outer panel rather than the nested one.
  const hasHiddenManualEntryFieldError =
    hasHiddenAdvancedFieldError || (!isConnected && (fields.apiKey.errors?.length ?? 0) > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Order while disconnected: DO first (quickstart), then the form, then
          the WHY (explainer) and the WHAT-IF (troubleshooting) as reference
          below it. Connected, both first-run cards drop away entirely. */}
      {/* The three-step BYOK quickstart is the wrong first thing to read on an
          instance that provides its own AI — "about two minutes" describes a
          detour when one tap in the card below is enough. The preset panel is
          that instance's quickstart; the BYOK route stays fully available
          underneath it. */}
      {!isConnected && instancePreset === null && <QuickstartCard recommendedProvider={recommendedProvider} />}
      <Card>
        <CardHeader>
          <CardTitle>{t('settingsAi.connectCard.title')}</CardTitle>
          <CardDescription>{t('settingsAi.connectCard.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {settings && <ConnectedPanel settings={settings} onDisconnected={() => setSettings(null)} />}
          {/* The instance's own AI, when its operator configured one (M138 spec
              06) — first thing in the card, above the key form it makes
              unnecessary. Renders nothing on an instance without a preset, so
              this line is invisible in every ordinary deployment. Only offered
              while nothing is connected: replacing a live connection is
              disconnect-then-reconnect here, same as for every provider. */}
          {!isConnected && <InstancePresetConnect onConnected={refreshSettings} />}
          {settingsUsageLine && <p className="text-xs text-muted-foreground">{settingsUsageLine}</p>}

          <Form method="post" {...getFormProps(form)} className="space-y-6">
            <input type="hidden" name={fields.provider.name} value={providerValue} />
            {hasCatalog && <input type="hidden" name={fields.model.name} value={effectiveCatalogModel} />}

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{t('settingsAi.providerRow.label')}</span>
              <Badge variant="secondary">{providerLabel({ provider: providerValue, t })}</Badge>
              <span className="text-xs">
                {isConnected ? t('settingsAi.providerRow.connectedHint') : t('settingsAi.providerRow.switchHint')}
              </span>
            </div>

            {/* Primary provider tabs — recommended-first for the UI language
                (M130/04). Only offered before anything is connected: switching
                a live connection still means disconnect, then reconnect. */}
            {!isConnected && primaryProviderDefinitions.length > 1 && (
              <fieldset className="flex flex-wrap gap-2" aria-label={t('settingsAi.providerTabs.legend')}>
                {primaryProviderDefinitions.map((definition) => {
                  const isActive = selectedProvider === definition.id;
                  return (
                    <button
                      key={definition.id}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => selectProvider(definition.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent/50',
                        isActive && 'border-primary bg-accent/40 font-medium',
                      )}
                    >
                      {t(definition.labelKey)}
                      {definition.id === recommendedProvider && (
                        <Badge variant="secondary">{t('settingsAi.model.recommended')}</Badge>
                      )}
                    </button>
                  );
                })}
              </fieldset>
            )}

            {!isConnected && selectedProviderBlurbKey && (
              <p className="text-sm text-muted-foreground">{t(selectedProviderBlurbKey)}</p>
            )}

            {hasCatalog && (
              <CatalogModelSection
                provider={providerValue}
                catalogModelId={catalogModelId}
                customModelId={customModelId}
                onSelectCatalogModel={(id) => {
                  setCatalogModelId(id);
                  setCustomModelId('');
                }}
                onCustomModelChange={setCustomModelId}
              />
            )}

            {/* A connected provider with NO curated catalog (a self-hosted
                endpoint) keeps model + base URL editable so the model can be
                tweaked without disconnecting. With a catalog, the picker above
                already covers it — rendering this too would put a second input
                named `model` in the same form. */}
            {isConnected && !hasCatalog && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor={fields.model.id}>{t('settingsAi.field.model')}</Label>
                  <Input
                    {...getInputProps(fields.model, { type: 'text' })}
                    placeholder={MODEL_PLACEHOLDER[providerValue]}
                  />
                  <FieldError id={fields.model.errorId} errors={fields.model.errors} />
                </div>

                {PROVIDER_REGISTRY[providerValue].baseUrl === null && (
                  <div className="grid gap-2">
                    <Label htmlFor={fields.baseUrl.id}>{t('settingsAi.field.baseUrl')}</Label>
                    <Input
                      {...getInputProps(fields.baseUrl, { type: 'text' })}
                      placeholder={OPENAI_COMPATIBLE_BASE_URL_PLACEHOLDER}
                    />
                    <p className="text-xs text-muted-foreground">{t(OPENAI_COMPATIBLE_BASE_URL_HELP_KEY)}</p>
                    <FieldError id={fields.baseUrl.errorId} errors={fields.baseUrl.errors} />
                  </div>
                )}
              </>
            )}

            {/* Provider switching and the API-key field belong only to first-time
                setup. Replacing a key means disconnect, then reconnect. */}
            {!isConnected && (
              <>
                {/* Primary CTA: one click, no key to copy — shown whenever the
                    currently-selected provider supports it (only openrouter today,
                    see vision/registry.ts). Rendered off that capability table,
                    never off a provider literal here. */}
                {supportsOauthPkce(selectedProvider) && (
                  <div className="space-y-2">
                    <OAuthConnectButton className="h-11 w-full" />
                    <p className="text-center text-xs text-muted-foreground">{t('settingsAi.oauth.noCardNote')}</p>
                  </div>
                )}

                <Collapsible
                  open={isManualEntryOpen || hasHiddenManualEntryFieldError}
                  onOpenChange={setIsManualEntryOpen}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                      {supportsOauthPkce(selectedProvider) ?
                        t('settingsAi.manualEntry.orPasteKey')
                      : t('settingsAi.manualEntry.enterKey')}
                    </button>
                  </CollapsibleTrigger>
                  {/* forceMount keeps the provider/model/base-URL/api-key inputs in the
                      DOM (so they always submit) while collapsed — same pattern as the
                      scan page's "Fine-tune portion & macros" panel. Without it, collapsing
                      this panel silently drops those values from the form. That in turn
                      means a validation error can land on any of them while this stays
                      visually hidden (`data-[state=closed]:hidden`) —
                      `hasHiddenManualEntryFieldError` above forces the `Collapsible` open
                      whenever that happens, so the `<FieldError>`s below are never silently
                      blocking a submit the user can't see a reason for. */}
                  <CollapsibleContent
                    forceMount
                    className="mt-3 space-y-4 rounded-md border p-4 data-[state=closed]:hidden"
                  >
                    <Collapsible open={isAdvancedOpen || hasHiddenAdvancedFieldError} onOpenChange={setIsAdvancedOpen}>
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
                        >
                          <ChevronDown className="h-3.5 w-3.5" /> {t('settingsAi.advanced.toggle')}
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent
                        forceMount
                        className="mt-3 space-y-4 rounded-md border p-4 data-[state=closed]:hidden"
                      >
                        {PROVIDER_REGISTRY[selectedProvider].placement === 'advanced' && (
                          <button
                            type="button"
                            onClick={() => selectProvider(recommendedProvider)}
                            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                          >
                            {t('settingsAi.advanced.backToRecommended', {
                              provider: providerLabel({ provider: recommendedProvider, t }),
                            })}
                          </button>
                        )}

                        <div className="grid gap-2">
                          {ADVANCED_PROVIDER_DEFINITIONS.map((definition) => (
                            <label key={definition.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name="advancedProviderChoice"
                                checked={selectedProvider === definition.id}
                                onChange={() => selectProvider(definition.id)}
                              />
                              {t(ADVANCED_OPTION_KEYS[definition.id] ?? definition.labelKey)}
                            </label>
                          ))}
                        </div>

                        {/* Free text only where there is nothing curated to pick
                            from; a provider WITH a catalog is served by the
                            picker above, which owns the `model` field. */}
                        {!hasCatalog && (
                          <div className="grid gap-2">
                            <Label htmlFor={fields.model.id}>{t('settingsAi.field.model')}</Label>
                            <Input
                              {...getInputProps(fields.model, { type: 'text' })}
                              placeholder={MODEL_PLACEHOLDER[selectedProvider]}
                            />
                            <FieldError id={fields.model.errorId} errors={fields.model.errors} />
                          </div>
                        )}

                        {PROVIDER_REGISTRY[selectedProvider].baseUrl === null && (
                          <div className="grid gap-2">
                            <Label htmlFor={fields.baseUrl.id}>{t('settingsAi.field.baseUrl')}</Label>
                            <Input
                              {...getInputProps(fields.baseUrl, { type: 'text' })}
                              placeholder={OPENAI_COMPATIBLE_BASE_URL_PLACEHOLDER}
                            />
                            <p className="text-xs text-muted-foreground">{t(OPENAI_COMPATIBLE_BASE_URL_HELP_KEY)}</p>
                            <FieldError id={fields.baseUrl.errorId} errors={fields.baseUrl.errors} />
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>

                    <div className="grid gap-2">
                      <Label htmlFor={fields.apiKey.id}>{t(API_KEY_LABEL_KEYS[selectedProvider])}</Label>
                      <Input
                        {...getInputProps(fields.apiKey, { type: 'password' })}
                        autoComplete="off"
                        // Empty string ⇒ no placeholder at all, for a provider
                        // whose keys carry no telltale prefix (see the table).
                        placeholder={API_KEY_PLACEHOLDERS[selectedProvider] || undefined}
                      />
                      {PROVIDER_REGISTRY[selectedProvider].baseUrl === null && (
                        <p className="text-xs text-muted-foreground">{t('settingsAi.apiKey.sentToBaseUrl')}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{t('settingsAi.apiKey.noKeyYet')}</p>
                      <FieldError id={fields.apiKey.errorId} errors={fields.apiKey.errors} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}

            <FieldError id={form.errorId} errors={form.errors} />

            <SubmitButton pending={isSubmitting} pendingLabel={savingLabel}>
              {idleLabel}
            </SubmitButton>
          </Form>
        </CardContent>
      </Card>
      {!isConnected && (
        <NotConnectedExplainer recommendedProvider={recommendedProvider} hasInstancePreset={instancePreset !== null} />
      )}
      <ScanTroubleshootingCard />
    </div>
  );
}
