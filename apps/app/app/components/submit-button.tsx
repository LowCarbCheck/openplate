import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '#app/components/ui/button';

type ButtonProps = React.ComponentProps<typeof Button>;

interface SubmitButtonProps extends ButtonProps {
  /** Whether the owning form is currently submitting. */
  pending: boolean;
  /** Label shown while pending; falls back to the button's children. */
  pendingLabel?: string;
}

/**
 * Shared submit button (DESIGN.md §7) — disables and shows a spinner while its
 * form is in flight so no submit ever looks frozen. Defaults `type` to
 * `submit`; callers may override any Button prop.
 */
export function SubmitButton({ pending, pendingLabel, children, disabled, ...props }: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending} {...props}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
