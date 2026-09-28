import pino from 'pino';

/**
 * One value in a structured log record. pino serializes exactly these; a
 * caller with anything else (a class instance, a Map) stringifies it first.
 */
export type LogValue =
  | string
  | number
  | boolean
  | Date
  | Error
  | null
  | undefined
  | readonly LogValue[]
  | { readonly [key: string]: LogValue };

/** The `{ userId }`-style metadata object attached to a log line. */
export type LogMeta = Readonly<Record<string, LogValue>>;

/**
 * Structured logger surface used throughout the app. Method signatures are
 * `(message, meta?)` — the opposite argument order from pino's own API — so
 * every call site reads like `logger.info('did the thing', { userId })`.
 */
export interface Logger {
  trace: (msg: string, meta?: LogMeta) => void;
  debug: (msg: string, meta?: LogMeta) => void;
  info: (msg: string, meta?: LogMeta) => void;
  warn: (msg: string, meta?: LogMeta) => void;
  error: (msg: string, meta?: LogMeta) => void;
  fatal: (msg: string, meta?: LogMeta) => void;
  child: (bindings: LogMeta) => Logger;
}

function wrapPinoLogger(instance: pino.Logger): Logger {
  return {
    trace: (msg, meta) => (meta ? instance.trace(meta, msg) : instance.trace(msg)),
    debug: (msg, meta) => (meta ? instance.debug(meta, msg) : instance.debug(msg)),
    info: (msg, meta) => (meta ? instance.info(meta, msg) : instance.info(msg)),
    warn: (msg, meta) => (meta ? instance.warn(meta, msg) : instance.warn(msg)),
    error: (msg, meta) => (meta ? instance.error(meta, msg) : instance.error(msg)),
    fatal: (msg, meta) => (meta ? instance.fatal(meta, msg) : instance.fatal(msg)),
    child: (bindings) => wrapPinoLogger(instance.child(bindings)),
  };
}

/**
 * Whether this module is evaluating in Node (where `process` and its stdio
 * exist) rather than the browser. This module is imported from BROWSER code
 * too (`app/lib/local-store/persist.ts`), and an unguarded top-level
 * `process.*` read throws `ReferenceError: process is not defined` there —
 * which kills the whole local-store module graph and hangs every
 * `_personal` route on its `HydrateFallback`. pino itself is browser-safe
 * (Vite resolves its `browser` build, which logs through `console`), so the
 * ONLY thing that has to be guarded is the environment access below.
 */
// SAFETY: @types/node declares `process` as an always-present global, but this
// module is bundled for the browser too, where it genuinely does not exist —
// the annotation restores the absence the type system hides.
const nodeProcess: NodeJS.Process | undefined = globalThis.process;
const isNodeRuntime = nodeProcess?.stdout !== undefined;

// Pretty-print only in non-production TTY sessions. `pino-pretty` is a
// devDependency, so production must never take this branch — pino only
// requires the transport target when it's actually selected. `&&`
// short-circuits before either `process` read in the browser.
const usePrettyTransport =
  isNodeRuntime && nodeProcess?.env.NODE_ENV !== 'production' && Boolean(nodeProcess?.stdout.isTTY);

const pinoInstance = pino({
  level: (isNodeRuntime ? process.env.LOG_LEVEL : undefined) || 'info',
  transport:
    usePrettyTransport ?
      { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined,
});

/**
 * Application-wide logger instance.
 */
export const logger: Logger = wrapPinoLogger(pinoInstance);

/**
 * Create a child logger for a specific component/module.
 *
 * @example
 * const log = createComponentLogger('AuthService');
 * log.info('User logged in', { userId: '123' });
 */
export function createComponentLogger(component: string): Logger {
  return logger.child({ component });
}
