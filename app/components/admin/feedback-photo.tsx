/**
 * The photograph on one report, in the four states it can be in.
 *
 * ── Presentational, and the fetch is somewhere else ──────────────────────
 *
 * It takes a state and draws it. The bytes are read by the route, which owns
 * the object URL and revokes it, because `renderToStaticMarkup` never runs an
 * effect and a component that fetched its own image would have no state a test
 * could reach but the empty one.
 *
 * ── "No photo" is not "failed" ───────────────────────────────────────────
 *
 * A report with `hasImage: false` is a meal that was typed in, or one whose
 * photograph the person's own device had already evicted before they pressed
 * the button. Nothing went wrong, the figures are still worth reading, and the
 * screen says so in words rather than drawing a broken frame.
 *
 * `gone` is the other absence: the report had a photograph and the service no
 * longer has it, which is the retention window doing its job. Also not a
 * failure, and a different sentence.
 */
import { useTranslation } from 'react-i18next';
import { ImageOff } from 'lucide-react';

/** Where the photograph for one report is. Four answers, and three of them are not an error. */
export type FeedbackPhotoState =
  /** The report carries none. A typed meal, or a photograph that had already been evicted on the device. */
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'ready'; src: string }
  /** The service answered 404: retention has already taken it. */
  | { kind: 'gone' }
  | { kind: 'failed' };

export interface FeedbackPhotoProps {
  reportId: number;
  state: FeedbackPhotoState;
}

export function FeedbackPhoto({ reportId, state }: FeedbackPhotoProps) {
  const { t } = useTranslation();

  if (state.kind === 'ready') {
    return (
      <img
        src={state.src}
        alt={t('admin.feedback.photoAlt', { id: reportId })}
        className="max-h-80 w-full rounded-lg border object-contain"
      />
    );
  }

  return (
    <p className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      {state.kind === 'none' && t('admin.feedback.noPhoto')}
      {state.kind === 'loading' && t('admin.feedback.photoLoading')}
      {state.kind === 'gone' && t('admin.feedback.photoGone')}
      {state.kind === 'failed' && t('admin.feedback.photoFailed')}
    </p>
  );
}
