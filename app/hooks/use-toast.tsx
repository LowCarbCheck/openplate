import type { Toast } from '#app/utils/toast.server';
import { useEffect, useRef } from 'react';
import { toast as showToast } from 'sonner';
import { useFetcher } from 'react-router';
import { z } from 'zod';

/**
 * The toast contract as it arrives back through a fetcher — a client-side
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

export function useToast(toast?: Toast | null) {
  const shown = useRef(new Set<string>());

  useEffect(() => {
    if (toast && !shown.current.has(toast.id)) {
      shown.current.add(toast.id);
      setTimeout(() => {
        showToast[toast.type](toast.title, {
          id: toast.id,
          description: toast.description,
        });
      }, 0);
    }
  }, [toast]);
}

export function useFetcherWithToast<T>() {
  const fetcher = useFetcher<T>();

  useEffect(() => {
    const parsed = fetcherToastSchema.safeParse(fetcher.data);
    if (!parsed.success) return;
    const { type, title, description, id } = parsed.data;

    switch (type) {
      case 'error':
        showToast.error(title, { id, description });
        break;
      case 'warning':
        showToast.warning(title, { id, description });
        break;
      case 'success':
        showToast.success(title, { id, description });
        break;
      case 'message':
      default:
        showToast.message(title, { id, description });
        break;
    }
  }, [fetcher.data]);

  return fetcher;
}
