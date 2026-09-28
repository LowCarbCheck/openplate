/**
 * The alert an intake screen shows when a provider call did not produce a
 * result, lifted out of `/scan`'s `UploadForm` (M233/02).
 *
 * ── It is deliberately thin ──────────────────────────────────────────────
 *
 * It owns the SHAPE of the alert and nothing else: which icon, and that the
 * headline sits above the body. Every decision about WHAT to say stays with
 * the caller, because the two callers do not know the same things. `/scan` has
 * a typed `VisionFailureCause`, a plans door, an allowance date and a
 * per-attempt credit line, and composes a body out of all four; `/pantry` has
 * a message and a subject. Pulling that reasoning in here would give this
 * component a `failureCause` prop that one caller always leaves undefined, and
 * a body one caller always overrides.
 *
 * ── The icon is the SUBJECT, not the failure ─────────────────────────────
 *
 * A photograph gets a camera, words get the type icon. It is the same rule
 * every sentence on these screens follows: "try a clearer shot" is advice
 * nobody can follow about a sentence they typed, and an icon makes the same
 * claim more quietly.
 */
import type { ReactElement, ReactNode } from 'react';
import { Camera, Type as TypeIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '#app/components/ui/alert';

/** Which kind of intake this alert is about, which decides the icon and nothing else. */
export type IntakeFailureSubject = 'photo' | 'text';

export function IntakeFailureAlert({
  subject,
  title,
  children,
}: {
  subject: IntakeFailureSubject;
  title: string;
  /** The body. A string, or the composed fragment `/scan` builds from a typed cause. */
  children: ReactNode;
}): ReactElement {
  return (
    <Alert>
      {subject === 'text' ?
        <TypeIcon className="h-4 w-4" />
      : <Camera className="h-4 w-4" />}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
