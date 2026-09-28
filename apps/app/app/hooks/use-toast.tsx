import type { Toast } from '#app/utils/toast.server';
import { useEffect, useRef } from 'react';
import { useFetcher } from 'react-router';
import { z } from 'zod';

import { publishStatus, type StatusTone } from '#app/lib/status';

/**
 * The two hooks that turn a SERVER-shaped message into a header status.
 *
 * The wire is unchanged: `#app/utils/toast.server` still flashes a message
 * through a cookie for the root loader, and a route action can still answer
 * with `createActionToastResponse`. What changed here is only where the
 * message lands in `#app/lib/status`, rendered by the app header, instead of a
 * floating toast layer that no longer exists.
 */

/**
 * The message contract as it arrives back through a fetcher, a client-side
 * mirror of `ToastSchema` in `#app/utils/toast.server`, which cannot be
 * imported here because that module is server-only. Fetcher payloads are an
 * I/O boundary, so the response is parsed rather than narrowed by hand.
 */
const fetcherToastSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string(),
  type: z.enum(['message', 'success', 'error', 'warning']),
});

/** The four variant names the server flash speaks. */
type ServerToastType = z.infer<typeof fetcherToastSchema>['type'];

/** Those four names, mapped onto the status channel's four tones. */
const TONE_BY_TYPE = {
  message: 'info',
  success: 'success',
  error: 'error',
  warning: 'warning',
} satisfies Record<ServerToastType, StatusTone>;

/** A title-less message reads as one line, exactly as it did in the toast layer. */
function publishServerToast({
  type,
  title,
  description,
}: {
  type: ServerToastType;
  title?: string;
  description: string;
}): void {
  publishStatus({
    text: title ?? description,
    description: title === undefined ? undefined : description,
    tone: TONE_BY_TYPE[type],
  });
}

export function useToast(toast?: Toast | null) {
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (!toast || shown.current.has(toast.id)) return;
    shown.current.add(toast.id);
    publishServerToast(toast);
  }, [toast]);
}

export function useFetcherWithToast<T>() {
  const fetcher = useFetcher<T>();

  useEffect(() => {
    const parsed = fetcherToastSchema.safeParse(fetcher.data);
    if (!parsed.success) return;
    publishServerToast(parsed.data);
  }, [fetcher.data]);

  return fetcher;
}
