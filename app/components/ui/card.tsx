import * as React from 'react';

import { cn } from '#app/lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  // M129/01: `rounded-2xl` is now the dominant card radius for primary content
  // cards (was `rounded-lg`) — chips/badges stay pill-shaped (`rounded-full`,
  // unaffected by this). Cards rest at `shadow-sm`, never heavier — hover
  // elevation (`hover:shadow-md`/`hover:shadow-lg`) is a per-instance opt-in
  // for interactive/list cards, not a Card-wide default.
  <div ref={ref} className={cn('rounded-2xl border bg-card text-card-foreground shadow-sm', className)} {...props} />
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    // DESIGN.md §4: a card title is a semibold label in the BODY face, at
    // `text-base` (16px). It used to be the display serif at `text-lg`
    // (M129, a serif card title over a tracked teal eyebrow on every card),
    // and that pairing is the generated-template signature M243 removed. The
    // brand face now draws the word "openplate" and nothing else, through
    // the `Wordmark` component, so a title here must never ask for it. The
    // body face is Victor Mono, which reads optically larger than Inter at
    // the same size, which is why the step down from `text-lg`. Callers with
    // a different size (auth screens' `text-xl`, onboarding's `text-2xl`)
    // still override via `className`. This is also a label, never a live
    // figure: every number that changes as you use the app lives in card
    // CONTENT with `tabular-nums`.
    <div
      ref={ref}
      data-slot="card-title"
      className={cn('text-base font-semibold leading-tight tracking-tight text-balance', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />,
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
