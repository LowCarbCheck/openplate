import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#app/components/ui/alert-dialog';
import { Button } from '#app/components/ui/button';
import { useFetcherWithToast } from '#app/hooks/use-toast';
import type { Toast } from '#app/utils/toast.server';

interface ConfirmActionProps {
  /** The trigger element (usually a button). */
  trigger: React.ReactNode;
  /** Title shown in the confirmation dialog. */
  title: string;
  /** Description shown in the confirmation dialog. Accepts rich content (e.g. a warning-styled link). */
  description: React.ReactNode;
  /** Hidden form fields submitted to the current route's action. */
  formData?: Record<string, string | number>;
  /** Text for the confirm button (defaults to the translated "Continue"). */
  confirmText?: string;
  /** Text for the cancel button (defaults to the translated "Cancel"). */
  cancelText?: string;
  /** Variant for the confirm button (destructive for delete/disconnect). */
  confirmVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  /** Called once the mutation settles (after the dialog auto-closes). */
  onSuccess?: () => void;
}

/**
 * AlertDialog confirmation for a destructive mutation (DESIGN.md §7) — replaces
 * every `window.confirm`. Submits `formData` to the current route's action via a
 * toast-aware fetcher and closes once the request settles. Works with actions
 * that either return a toast object (`createActionToastResponse`, surfaced by
 * `useFetcherWithToast`) or `redirectWithToast` (surfaced by the root loader
 * toast) — the fetcher no-ops on the redirect case and the cookie toast wins.
 */
/** Stable default for `formData`: a fresh `{}` per render would change the prop identity on every render. */
const NO_FORM_DATA = {};

export function ConfirmAction({
  trigger,
  title,
  description,
  formData = NO_FORM_DATA,
  confirmText,
  cancelText,
  confirmVariant = 'default',
  onSuccess,
}: ConfirmActionProps) {
  // Defaults resolve here rather than in the parameter list: a default value
  // can't call a hook, and these two labels are the only copy this shared
  // component owns (every other string is passed in already-translated by the
  // calling surface).
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const fetcher = useFetcherWithToast<Toast>();
  const isSubmitting = fetcher.state !== 'idle';
  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (isSubmitting) {
      wasSubmitting.current = true;
      return;
    }
    if (!wasSubmitting.current) return;
    wasSubmitting.current = false;
    setOpen(false);
    onSuccess?.();
  }, [isSubmitting, onSuccess]);
  const handleConfirm = (): void => {
    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });
    fetcher.submit(form, { method: 'post' });
  };
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>{cancelText ?? t('confirm.cancel')}</AlertDialogCancel>
          <Button variant={confirmVariant} onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {confirmText ?? t('confirm.continue')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
