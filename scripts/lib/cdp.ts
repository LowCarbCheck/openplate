/**
 * A minimal Chrome DevTools Protocol client, spoken over the `WebSocket` that
 * Node 22 ships as a global.
 *
 * ── Why this exists rather than a browser driver ─────────────────────────
 *
 * `scripts/capture-landing.ts` does exactly six things to a page: open it,
 * override the clock and the colour scheme, clear the origin's storage, seed
 * IndexedDB through the app's own import path, resize the viewport, and take a
 * WebP screenshot. Every one of those is a single CDP command. Puppeteer or
 * Playwright would each add a large dependency, a second downloaded browser,
 * and a version to keep in step with whichever Chrome the host already has.
 * This repository has no browser driver today, and the whole protocol surface
 * the capture needs fits in the two exports below, so the driver is cheaper to
 * write than to depend on. That is the entire justification; if the capture
 * ever needs input emulation, tracing or network interception, buy the
 * dependency instead of growing this file.
 *
 * ── Why every frame is decoded rather than read ──────────────────────────
 *
 * A CDP reply is untrusted JSON. It can carry a protocol `error` in place of a
 * `result`, and `Runtime.evaluate` reports a thrown page exception as an
 * otherwise perfectly successful reply that happens to carry
 * `exceptionDetails`. Reading those fields off a raw `JSON.parse` would let a
 * page that threw look identical to a page that returned nothing, and the
 * capture would write a screenshot of a blank document with a zero exit code.
 * That is precisely the failure `tests/unit/landing-assets.test.ts` was
 * written for, one rung further down: the page renders, the file exists, and
 * the picture is empty. So each frame goes through zod and every unhappy shape
 * becomes a thrown error naming the command that produced it.
 */
import { z } from 'zod';

/** Every value JSON can carry. The whole vocabulary of the DevTools wire. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A command's `params`, and the `result` object its reply carries. */
export type CdpObject = { [key: string]: JsonValue };

/** One open page (a CDP target) plus the socket that drives it. */
export interface CdpPage {
  /**
   * Send one command and resolve with its `result` object (`{}` when the
   * command returns nothing). Rejects when the browser answers with a protocol
   * error, when the socket dies, or when no reply arrives in time.
   */
  send(method: string, params?: CdpObject): Promise<CdpObject>;
  /**
   * Evaluate `expression` in the page and return its value. Promises are
   * awaited and the result is returned by value, so the expression may be an
   * async IIFE. Rejects when the page threw and when the expression produced
   * no value at all, because both of those are, for a capture, a blank screen.
   */
  evaluate<T>(expression: string): Promise<T>;
  /**
   * Close the TARGET and the socket, and reject anything still in flight.
   *
   * Closing the socket alone leaves the tab alive in the browser, and a run
   * that opens one page per shot would then accumulate tabs, which is the
   * exact leak the per-shot pages exist to avoid. So this also asks the
   * browser to close the target, which is an HTTP call, which is why it is
   * async.
   *
   * It THROWS when the browser refuses. Called from a `finally`, that can
   * replace an earlier failure, so a "could not close" message is a reason to
   * look for a cause before it as well.
   */
  close(): Promise<void>;
}

/**
 * A reply that never arrives must not hang a run forever. Generous rather than
 * tight: `Page.captureScreenshot` on a 2160-wide viewport is the slowest
 * command here and it is still far under a second, so anything approaching
 * this ceiling is a hung browser, not a slow one.
 */
const REPLY_TIMEOUT_MS = 30_000;

/** How much of a page exception or a bad frame is quoted in an error message. */
const QUOTED_TEXT_LIMIT = 600;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const cdpObjectSchema = z.record(z.string(), jsonValueSchema);

const newTargetSchema = z.object({ id: z.string().min(1), webSocketDebuggerUrl: z.string().min(1) });

/**
 * One inbound frame. `id` is absent on a protocol EVENT (`Page.loadEventFired`
 * and friends), which nothing here subscribes to; `result` and `error` are
 * mutually exclusive on a reply.
 */
const messageSchema = z.object({
  id: z.number().optional(),
  result: cdpObjectSchema.optional(),
  error: z.object({ message: z.string() }).optional(),
});

const evaluateReplySchema = z.object({
  result: z.object({ value: jsonValueSchema.optional() }),
  exceptionDetails: cdpObjectSchema.optional(),
});

type PendingReply = {
  method: string;
  resolve: (result: CdpObject) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function quote(text: string): string {
  return text.length <= QUOTED_TEXT_LIMIT ? text : `${text.slice(0, QUOTED_TEXT_LIMIT)}... (${text.length} chars)`;
}

/** A fresh tab: the id the browser closes it by, and the socket that drives it. */
type CdpTarget = {
  id: string;
  socketUrl: string;
};

/**
 * Ask the browser for a fresh `about:blank` target. The verb is PUT, not GET:
 * Chrome 111 and later reject a GET on `/json/new` as a cross-protocol request.
 */
async function openTarget(browserUrl: string): Promise<CdpTarget> {
  const response = await fetch(`${browserUrl}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) {
    throw new Error(
      `The CDP endpoint ${browserUrl} refused to open a target (HTTP ${response.status}). Is a headless Chrome listening there with --remote-debugging-port?`,
    );
  }
  const target = newTargetSchema.safeParse(await response.json());
  if (!target.success) {
    throw new Error(
      `The CDP endpoint ${browserUrl} answered /json/new without an id and a webSocketDebuggerUrl. That is not a DevTools endpoint, or the browser refused the origin (pass --remote-allow-origins=*).`,
    );
  }
  return { id: target.data.id, socketUrl: target.data.webSocketDebuggerUrl };
}

/**
 * Open a page on a running browser and return the handle that drives it.
 *
 * @param browserUrl - the DevTools HTTP endpoint, e.g. `http://127.0.0.1:9333`.
 */
export async function openPage(browserUrl: string): Promise<CdpPage> {
  const target = await openTarget(browserUrl);
  const socket = new WebSocket(target.socketUrl);
  const pending = new Map<number, PendingReply>();
  let lastId = 0;

  /**
   * Reject everything in flight at once. Used for a socket that closed and for
   * a frame this client cannot read: in both cases no further reply is coming,
   * and waiting out the 30 second timeout on each pending command would turn
   * one dead browser into minutes of silence.
   */
  const failAll = (error: Error): void => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };

  const handleFrame = (frame: string): void => {
    const parsed = messageSchema.safeParse(JSON.parse(frame));
    if (!parsed.success) {
      failAll(new Error(`The CDP socket sent a frame this client cannot read: ${quote(frame)}`));
      return;
    }
    const { id, result, error } = parsed.data;
    // An event, not a reply. Nothing here subscribes to events, so drop it.
    if (id === undefined) return;
    const waiter = pending.get(id);
    // Already timed out and already rejected; its caller has moved on.
    if (waiter === undefined) return;
    pending.delete(id);
    clearTimeout(waiter.timer);
    if (error !== undefined) {
      waiter.reject(new Error(`CDP ${waiter.method} failed: ${error.message}`));
      return;
    }
    waiter.resolve(result ?? {});
  };

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error(`Could not open the CDP socket ${target.socketUrl}.`)),
      { once: true },
    );
  });

  socket.addEventListener('message', (event) => {
    try {
      handleFrame(String(event.data));
    } catch {
      failAll(new Error('The CDP socket sent a frame that is not JSON.'));
    }
  });
  socket.addEventListener('close', () => {
    failAll(new Error('The CDP socket closed while commands were still in flight. The browser probably exited.'));
  });

  const send = (method: string, params: CdpObject = {}): Promise<CdpObject> =>
    new Promise<CdpObject>((resolve, reject) => {
      lastId += 1;
      const id = lastId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} did not answer within ${REPLY_TIMEOUT_MS} ms.`));
      }, REPLY_TIMEOUT_MS);
      pending.set(id, { method, resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async <T>(expression: string): Promise<T> => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    const parsed = evaluateReplySchema.parse(reply);
    if (parsed.exceptionDetails !== undefined) {
      throw new Error(`The page threw while evaluating an expression: ${quote(JSON.stringify(parsed.exceptionDetails))}`);
    }
    if (parsed.result.value === undefined) {
      throw new Error(
        `An expression returned no value. Every caller here expects one back, so this means the page never ran the code: ${quote(expression)}`,
      );
    }
    // SAFETY: the protocol hands back an arbitrary JSON value and only the
    // caller knows the shape its own expression produces, so the contract is
    // the caller's to state. This is the single boundary cast in this module,
    // and the guards above make it a cast of a value that certainly exists.
    return parsed.result.value as T;
  };

  const close = async (): Promise<void> => {
    failAll(new Error('The CDP page was closed while commands were still in flight.'));
    socket.close();
    const response = await fetch(`${browserUrl}/json/close/${target.id}`);
    if (!response.ok) {
      throw new Error(
        `The browser refused to close target ${target.id} (HTTP ${response.status}). The tab is still open, and a run that leaves tabs behind is the leak this call exists to prevent.`,
      );
    }
  };

  return { send, evaluate, close };
}
