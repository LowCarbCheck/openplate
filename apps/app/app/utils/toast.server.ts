import { randomBytes } from 'node:crypto';
import { createId as cuid } from '@paralleldrive/cuid2';
import { createCookieSessionStorage, redirect } from 'react-router';
import { z } from 'zod';
import { CONFIG } from '#app/config';
import { combineHeaders } from '#app/utils/misc';

export const toastKey = 'toast';

/**
 * Signing key for the toast flash cookie — generated fresh at boot, never
 * configured (M128 spec 03: this app boots with zero secrets, so there is no
 * `SESSION_SECRET` to borrow any more).
 *
 * An ephemeral key is the RIGHT trade-off for this cookie specifically, not a
 * shortcut: its entire payload is a one-shot UI toast ("Entry deleted"), it is
 * flashed and destroyed on the very next request, and it carries no identity —
 * there are no accounts. The only consequence of the key changing is that a
 * toast in flight across a server restart silently doesn't render, which is
 * indistinguishable from the message simply having been shown already. Signing
 * still buys the one thing worth having: the cookie can't be hand-forged into
 * arbitrary rendered copy.
 *
 * Do NOT reach for this pattern for anything durable — a value that must
 * survive a restart or be readable by a second replica needs real configured
 * key material, which is exactly the kind of thing this app no longer has.
 */
const TOAST_COOKIE_SECRET = randomBytes(32).toString('hex');

const ToastSchema = z.object({
  id: z.string().default(() => cuid()),
  title: z.string().optional(),
  description: z.string(),
  type: z.enum(['message', 'success', 'error', 'warning']).default('message'),
});

export type Toast = z.infer<typeof ToastSchema>;
export type ToastInput = z.input<typeof ToastSchema>;

export const toastSessionStorage = createCookieSessionStorage({
  cookie: {
    name: 'en_toast',
    sameSite: 'lax',
    path: '/',
    httpOnly: true,
    secrets: [TOAST_COOKIE_SECRET],
    secure: CONFIG.app.isProduction,
  },
});

export async function redirectWithToast(url: string, toast: ToastInput, init?: ResponseInit) {
  return redirect(url, {
    ...init,
    headers: combineHeaders(init?.headers, await createToastHeaders(toast)),
  });
}

export async function createToastHeaders(toastInput: ToastInput) {
  const session = await toastSessionStorage.getSession();
  const toast = ToastSchema.parse(toastInput);
  session.flash(toastKey, toast);
  const cookie = await toastSessionStorage.commitSession(session);
  return new Headers({ 'set-cookie': cookie });
}

export async function getToast(request: Request) {
  const session = await toastSessionStorage.getSession(request.headers.get('cookie'));
  const result = ToastSchema.safeParse(session.get(toastKey));
  const toast = result.success ? result.data : null;
  return {
    toast,
    headers:
      toast ?
        new Headers({
          'set-cookie': await toastSessionStorage.destroySession(session),
        })
      : null,
  };
}

export function createActionToastResponse(actionToast: Toast) {
  return {
    description: actionToast.description,
    title: actionToast.title,
    id: actionToast.id,
    type: actionToast.type,
  };
}
