interface FieldErrorProps {
  /** Wire to a field's `errorId` so inputs can reference it via aria-describedby. */
  id?: string;
  /** Conform field errors — renders nothing when absent or empty. */
  errors?: string[];
}

/**
 * Shared field-error renderer (DESIGN.md §6) — the single place Conform field
 * errors turn into red helper text, so no route re-inlines the red `<p>`.
 */
export function FieldError({ id, errors }: FieldErrorProps) {
  if (!errors || errors.length === 0) return null;
  return (
    <p id={id} className="text-sm text-red-600 dark:text-red-400">
      {errors.join(', ')}
    </p>
  );
}
