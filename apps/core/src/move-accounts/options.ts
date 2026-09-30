/**
 * The command line of `node dist/move-accounts.js`, parsed into
 * {@link MoveOptions} or refused with a reason. Pure: argv and an environment
 * in, a decision out, so every refusal is unit-tested without a database.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT ONLY, as `pnpm sync-api` takes its
 * token: a database URL or a secret on a command line lands in shell history
 * and in `ps`. There is no flag for any of the four, and no dotenv.
 *
 * `--dry-run` IS THE DEFAULT. Writing needs `--apply`, spelled out; both at
 * once is refused rather than resolved in either direction.
 */
import { parseArgs } from 'node:util';
import { MIN_SERVER_SECRET_LENGTH } from '../config.js';
import { MAX_DAILY_AI_LIMIT } from '../admin/invite-store.js';
import { MAX_ACCOUNT_LABEL_LENGTH } from '../admin/account-label.js';
import { parseEmail } from '../accounts/auth-input.js';
import type { MoveOptions } from './run.js';

/** What a moved account is labelled when `--label` is absent (owner decision, 2026-09-30). */
export const DEFAULT_MOVE_LABEL = 'Beta supporter';

/** The daily AI allowance a moved account gets when `--daily-ai-limit` is absent (owner decision, 2026-09-30). */
export const DEFAULT_MOVE_DAILY_AI_LIMIT = 10;

export const MOVE_USAGE = `Usage: node dist/move-accounts.js [--dry-run | --apply] [--skip-email <address>]... [--label <text>] [--daily-ai-limit <n>]

Moves accounts from one openplate-core database to another. Dry run unless --apply.

Environment (all four required, never flags):
  SOURCE_DATABASE_URL        the database the accounts leave (read only, never written)
  TARGET_DATABASE_URL        the database they arrive in
  SOURCE_SERVER_SECRET       the source instance's SERVER_SECRET, which the target adopts at the switch
  TARGET_OLD_SERVER_SECRET   the target instance's SERVER_SECRET before the switch

Options:
  --dry-run                  prove everything and write nothing (the default)
  --apply                    write, one transaction per account
  --skip-email <address>     leave this account on the source (repeatable)
  --label <text>             the label moved accounts get (default "${DEFAULT_MOVE_LABEL}")
  --daily-ai-limit <n>       the daily AI allowance moved accounts get (default ${DEFAULT_MOVE_DAILY_AI_LIMIT})
`;

export type MoveCommand =
  | { readonly kind: 'run'; readonly options: MoveOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'usage-error'; readonly reason: string };

const REQUIRED_ENVIRONMENT = [
  'SOURCE_DATABASE_URL',
  'TARGET_DATABASE_URL',
  'SOURCE_SERVER_SECRET',
  'TARGET_OLD_SERVER_SECRET',
] as const;

function usageError(reason: string): MoveCommand {
  return { kind: 'usage-error', reason };
}

function parseLabel(raw: string | undefined): string | null {
  const label = (raw ?? DEFAULT_MOVE_LABEL).trim();
  const length = [...label].length;
  return length >= 1 && length <= MAX_ACCOUNT_LABEL_LENGTH ? label : null;
}

function parseDailyAiLimit(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_MOVE_DAILY_AI_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  return limit <= MAX_DAILY_AI_LIMIT ? limit : null;
}

function parseSkipEmails(raw: readonly string[]): string[] | null {
  const parsed = raw.map((value) => parseEmail(value));
  if (parsed.some((result) => !result.ok)) return null;
  return parsed.flatMap((result) => (result.ok ? [result.value] : []));
}

function readEnvironment(env: NodeJS.ProcessEnv): Map<string, string> | string {
  const values = new Map<string, string>();
  for (const name of REQUIRED_ENVIRONMENT) {
    const value = env[name]?.trim() ?? '';
    if (value.length === 0) return `${name} is not set`;
    values.set(name, value);
  }
  for (const name of ['SOURCE_SERVER_SECRET', 'TARGET_OLD_SERVER_SECRET'] as const) {
    if ((values.get(name) ?? '').length < MIN_SERVER_SECRET_LENGTH) {
      return `${name} is shorter than ${MIN_SERVER_SECRET_LENGTH} characters, so it cannot be a SERVER_SECRET`;
    }
  }
  if (values.get('SOURCE_DATABASE_URL') === values.get('TARGET_DATABASE_URL')) {
    return 'SOURCE_DATABASE_URL and TARGET_DATABASE_URL are the same';
  }
  return values;
}

export function parseMoveCommand(input: { argv: readonly string[]; env: NodeJS.ProcessEnv }): MoveCommand {
  let parsed: ReturnType<typeof parseFlags>;
  try {
    parsed = parseFlags(input.argv);
  } catch (cause) {
    return usageError(cause instanceof Error ? cause.message : 'the arguments could not be parsed');
  }
  if (parsed.help === true) return { kind: 'help' };
  if (parsed['dry-run'] === true && parsed.apply === true)
    return usageError('--dry-run and --apply exclude each other');

  const label = parseLabel(parsed.label);
  if (label === null) return usageError(`--label must be 1 to ${MAX_ACCOUNT_LABEL_LENGTH} characters`);
  const dailyAiLimit = parseDailyAiLimit(parsed['daily-ai-limit']);
  if (dailyAiLimit === null)
    return usageError(`--daily-ai-limit must be a whole number from 0 to ${MAX_DAILY_AI_LIMIT}`);
  const skipEmails = parseSkipEmails(parsed['skip-email'] ?? []);
  if (skipEmails === null) return usageError('every --skip-email must be an email address');

  const environment = readEnvironment(input.env);
  if (!(environment instanceof Map)) return usageError(environment);
  return {
    kind: 'run',
    options: {
      mode: parsed.apply === true ? 'apply' : 'dry-run',
      sourceDatabaseUrl: environment.get('SOURCE_DATABASE_URL') ?? '',
      targetDatabaseUrl: environment.get('TARGET_DATABASE_URL') ?? '',
      sourceServerSecret: environment.get('SOURCE_SERVER_SECRET') ?? '',
      targetOldServerSecret: environment.get('TARGET_OLD_SERVER_SECRET') ?? '',
      skipEmails,
      standing: { dailyAiLimit, label },
    },
  };
}

function parseFlags(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    strict: true,
    allowPositionals: false,
    options: {
      'dry-run': { type: 'boolean' },
      apply: { type: 'boolean' },
      'skip-email': { type: 'string', multiple: true },
      label: { type: 'string' },
      'daily-ai-limit': { type: 'string' },
      help: { type: 'boolean' },
    },
  }).values;
}
