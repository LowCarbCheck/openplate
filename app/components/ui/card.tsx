import * as React from 'react';

import { cn } from '#app/lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  // A card draws no radius (`app/app.css`'s `--radius`, DESIGN.md section 5):
  // square corners everywhere, operator decision 2026-09-22. It was the
  // ladder's 8px step from M243 spec 03 until then, and 16px from M129/01
  // before that.
  //
  // `data-slot` is the identity, not the corner. Three browser specs used to
  // find a card as `div.rounded-2xl.bg-card`, which is a test that fails the
  // day a taste call moves, and passes vacuously the day it moves and nobody
  // notices. Cards rest at `shadow-sm`, never heavier; hover elevation is a
  // per-instance opt-in for interactive rows, not a Card-wide default.
  <div
    ref={ref}
    data-slot="card"
    className={cn('border bg-card text-card-foreground shadow-sm', className)}
    {...props}
  />
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
    // `text-lg` (18px). It used to be the display serif at `text-lg` over a
    // tracked teal eyebrow (M129), and that pairing is the generated-template
    // signature M243 removed. M243 also stepped the default down to 16px, but
    // fourteen Insights cards kept an explicit `text-lg`, so one screen carried
    // 16px and 18px titles over the same 14px body, and no title stood clear of
    // the text under it. On 2026-09-21 the operator called the cards flat, with
    // no visual hierarchy, so the default is 18px and the overrides are gone.
    // The brand face draws the word "openplate" and nothing else, through the
    // `Wordmark` component, so a title here must never ask for it. Callers with
    // a different size (auth screens' `text-xl`, onboarding's `text-2xl`)
    // still override via `className`. This is also a label, never a live
    // figure: every number that changes as you use the app lives in card
    // CONTENT with `tabular-nums`.
    <div
      ref={ref}
      data-slot="card-title"
      className={cn('text-lg font-semibold leading-tight tracking-tight text-balance', className)}
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
