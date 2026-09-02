/**
 * `/study` — the researcher's console (M163/03, `openplate-sync` ADR-0003).
 *
 * ── A second persona, at the top level ───────────────────────────────────
 *
 * `/shared` established the shape: somebody who is not this device's diary
 * owner gets a screen of their own, at the root of the app, with NO loader.
 * This is that again, one recipient class over. It exports no `loader`,
 * `action`, `clientLoader` or `clientAction`, and none may be added: the
 * study's private key is unwrapped in this browser, and a server that could
 * see any part of that traffic would be a server that could be asked for it.
 *
 * It sits OUTSIDE `_personal` on purpose. That layout runs the onboarding gate
 * and mounts `SyncController`, both of which are about the device owner's
 * diary — and a researcher opening this console may have no diary at all.
 *
 * ── The account here is the STUDY's, never the researcher's ──────────────
 *
 * Two accounts, two passphrases, two compartments, two vaults. The console's
 * session lives in `research/study-session.ts` and is never published to
 * `sync-session.ts`, so nothing that syncs a diary can see it and nothing here
 * can reach a diary. Its outgoing blob is an EMPTY diary plus the study's own
 * compartment (`research/study-snapshot.ts`), which is what stops the
 * researcher's own diary from being pushed into an account whose fingerprint
 * is printed in a consent document.
 *
 * ── Sign-in per use ──────────────────────────────────────────────────────
 *
 * Leaving this screen closes the session. There is no hint, no token and no
 * state on disk: a study console is opened deliberately, for as long as it is
 * being used.
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { FlaskConical, Loader2 } from 'lucide-react';

import { RouteErrorBoundary } from '#app/components/route-error-boundary';
import { StudyCohortPanel } from '#app/components/study-cohort-panel';
import { StudyKeyCard } from '#app/components/study-key-card';
import { Alert, AlertDescription, AlertTitle } from '#app/components/ui/alert';
import { Button } from '#app/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#app/components/ui/card';
import { Input } from '#app/components/ui/input';
import { Label } from '#app/components/ui/label';
import { useSyncServerUrl } from '#app/hooks/use-public-config';
import { metaLanguage, metaTitle } from '#app/i18n/meta-title';
import { generateHandle, normalizeHandle } from '#app/lib/sync/handle';
import { describeErrorForUser } from '#app/lib/sync/error-text';
import {
  buildExportHeaderLines,
  buildResearchExportStrings,
  exportStudyCohortCsv,
  type Translate,
} from '#app/lib/sync/research/export';
import type { StudyCohort } from '#app/lib/sync/research/study';
import { toneCohortLines } from '#app/lib/sync/research/study-console-view';
import {
  closeStudyConsole,
  createStudyAccount,
  generateStudyKey,
  loadStudyIdentity,
  pullCohort,
  signInToStudy,
  type StudyConsoleIdentity,
} from '#app/lib/sync/research/study-session';

export { RouteErrorBoundary as ErrorBoundary };

export const meta: MetaFunction = ({ matches }) => [{ title: metaTitle(metaLanguage(matches), 'meta.study') }];

export const handle = {
  titleKey: 'research.console.title',
  title: 'Study console',
};

/** Where the console is. `open` is the only state that has a vault behind it. */
type ConsoleState = { status: 'signed-out' } | { status: 'open'; identity: StudyConsoleIdentity };

/** What a pull produced. `unavailable` is a deployment with no research lane, which is not an error (ADR-0003 prohibition 9). */
type CohortState = { status: 'idle' } | { status: 'unavailable' } | { status: 'ready'; cohort: StudyCohort };

/** Triggers a browser download. Browser-only, and the file never leaves this device on the way. */
function downloadCsv({ filename, body }: { filename: string; body: string }): void {
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function StudyConsole() {
  const syncServerUrl = useSyncServerUrl();
  // The gate, and the whole of it: with no sync there is no study account to
  // sign into, so the console renders one honest sentence and constructs no
  // client. Everything below takes the URL as a string, so there is no path
  // on which a sign-in could be attempted against an absent one.
  if (syncServerUrl === null) return <NoSyncCard />;
  return <StudyConsoleBody serverUrl={syncServerUrl} />;
}

function StudyConsoleBody({ serverUrl }: { serverUrl: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<ConsoleState>({ status: 'signed-out' });
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  // Leaving the console ends the session. There is nothing to persist and
  // nothing that should outlive the screen.
  useEffect(() => closeStudyConsole, []);

  async function run(operation: () => Promise<void>, failureKey: string): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(describeErrorForUser(caught, t(failureKey)));
    } finally {
      setIsBusy(false);
    }
  }

  function handleSignIn({
    handle: accountHandle,
    passphrase,
    isNewAccount,
  }: {
    handle: string;
    passphrase: string;
    isNewAccount: boolean;
  }): void {
    void run(async () => {
      setRecoveryCode(null);
      if (isNewAccount) {
        const created = await createStudyAccount({ serverUrl, handle: accountHandle, passphrase });
        setRecoveryCode(created.recoveryCode);
      } else {
        const signedIn = await signInToStudy({ serverUrl, handle: accountHandle, passphrase });
        if (signedIn.status === 'setup-completed') setRecoveryCode(signedIn.recoveryCode);
      }
      setState({ status: 'open', identity: await loadStudyIdentity() });
    }, 'research.console.signIn.failed');
  }

  function handleGenerate(): void {
    void run(async () => {
      setState({ status: 'open', identity: await generateStudyKey() });
    }, 'research.console.identity.failed');
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <FlaskConical className="h-6 w-6 text-primary" aria-hidden="true" /> {t('research.console.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('research.console.description')}</p>
        {/* `research.console.separateAccount` used to be repeated here, word for
            word, above the sign-in card that already carries it as its
            description. Kept in the card: that is where the sentence is
            actually acting on a decision the reader is about to make. */}
      </header>

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      {recoveryCode !== null && (
        <Alert>
          <AlertTitle>{t('research.console.recoveryCode.title')}</AlertTitle>
          <AlertDescription className="space-y-2">
            <span className="block font-mono text-base tracking-widest">{recoveryCode}</span>
            <span className="block">{t('research.console.recoveryCode.body')}</span>
          </AlertDescription>
        </Alert>
      )}

      {state.status === 'signed-out' && <SignInCard onSubmit={handleSignIn} isBusy={isBusy} />}

      {state.status === 'open' && (
        <>
          <StudyKeyCard identity={state.identity} onGenerate={handleGenerate} isBusy={isBusy} />
          <CohortSection />
        </>
      )}
    </div>
  );
}

function NoSyncCard() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>{t('research.console.noSync.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('research.console.noSync.body')}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function SignInCard({
  onSubmit,
  isBusy,
}: {
  onSubmit: (input: { handle: string; passphrase: string; isNewAccount: boolean }) => void;
  isBusy: boolean;
}) {
  const { t } = useTranslation();
  // Minted, not typed — the same rule the diary's ceremony follows
  // (`app/lib/sync/handle.ts`), and the field stays editable.
  const [accountHandle, setAccountHandle] = useState(generateHandle);
  const [passphrase, setPassphrase] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ handle: normalizeHandle(accountHandle), passphrase, isNewAccount: false });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('research.console.signIn.title')}</CardTitle>
        <CardDescription>{t('research.console.separateAccount')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="study-console-handle">{t('research.console.signIn.handleLabel')}</Label>
            <Input
              id="study-console-handle"
              type="text"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              className="font-mono"
              value={accountHandle}
              onChange={(event) => setAccountHandle(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="study-console-passphrase">{t('research.console.signIn.passphraseLabel')}</Label>
            <Input
              id="study-console-passphrase"
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={isBusy || accountHandle === '' || passphrase === ''}>
            {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('research.console.signIn.signIn')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            disabled={isBusy || accountHandle === '' || passphrase === ''}
            onClick={() => onSubmit({ handle: normalizeHandle(accountHandle), passphrase, isNewAccount: true })}
          >
            {t('research.console.signIn.create')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The pull, the summary and the export.
 *
 * The window is ASKED FOR rather than inferred from the rows: it is the window
 * the study asked contributors for, an empty cohort still has one, and
 * `exportStudyCohortCsv` echoes it into the file.
 */
function CohortSection() {
  const { t } = useTranslation();
  const [fromDayKey, setFromDayKey] = useState('');
  const [toDayKey, setToDayKey] = useState('');
  const [cohort, setCohort] = useState<CohortState>({ status: 'idle' });
  const [isPulling, setIsPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The export's sentences, from the shipped catalog — the same object the
  // file's preamble is built from, so the screen cannot drift from it.
  const translate: Translate = (key, params) => t(key, params);
  const strings = buildResearchExportStrings(translate);

  async function handlePull(): Promise<void> {
    setIsPulling(true);
    setError(null);
    try {
      const pulled = await pullCohort();
      setCohort(
        pulled.status === 'unavailable' ? { status: 'unavailable' } : { status: 'ready', cohort: pulled.value },
      );
    } catch (caught) {
      setError(describeErrorForUser(caught, t('research.console.cohort.failed')));
    } finally {
      setIsPulling(false);
    }
  }

  function handleExport(): void {
    if (cohort.status !== 'ready') return;
    downloadCsv({
      filename: `study-cohort-${fromDayKey}-${toDayKey}.csv`,
      body: exportStudyCohortCsv({ cohort: cohort.cohort, fromDayKey, toDayKey, strings }),
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('research.console.cohort.title')}</CardTitle>
          <CardDescription>{t('research.console.cohort.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="study-cohort-from">{t('research.console.cohort.fromLabel')}</Label>
              <Input
                id="study-cohort-from"
                type="date"
                value={fromDayKey}
                onChange={(event) => setFromDayKey(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="study-cohort-to">{t('research.console.cohort.toLabel')}</Label>
              <Input
                id="study-cohort-to"
                type="date"
                value={toDayKey}
                onChange={(event) => setToDayKey(event.target.value)}
              />
            </div>
          </div>

          <Button
            type="button"
            className="h-11 w-full"
            disabled={isPulling || fromDayKey === '' || toDayKey === ''}
            onClick={() => void handlePull()}
          >
            {isPulling && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {isPulling ? t('research.console.cohort.pulling') : t('research.console.cohort.pull')}
          </Button>

          {error !== null && <p className="text-sm text-destructive">{error}</p>}
          {cohort.status === 'unavailable' && (
            <p className="text-sm text-muted-foreground">{t('research.console.cohort.unavailable')}</p>
          )}
        </CardContent>
      </Card>

      {cohort.status === 'ready' && (
        <StudyCohortPanel
          lines={toneCohortLines({
            // The screen's sentences and the file's are ONE call to one
            // builder — the export writes the same array, one function down.
            lines: buildExportHeaderLines({ cohort: cohort.cohort, fromDayKey, toDayKey, strings }),
            cohort: cohort.cohort,
          })}
          participantCount={cohort.cohort.rows.length}
          onExport={handleExport}
        />
      )}
    </div>
  );
}
