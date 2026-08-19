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
    // DESIGN.md §4: card title is `text-lg font-semibold` — this was previously
    // unsized (inherited body text size), which is why card headlines (a day's net
    // carbs, a food name, a section title) read flat against their own body copy.
    // Callers with a different weight (auth screens' `text-xl`, onboarding's
    // `text-2xl`) still override via `className`.
    //
    // M129 soul pass: card titles now carry the display serif (`font-display`,
    // Fraunces — see app.css). This is the single highest-leverage place to
    // spread the brand voice past the hero, because every screen in the app has
    // card titles and almost none of them had any brand character at all. It is
    // safe HERE and nowhere near a live figure: a card TITLE is always a label
    // ("This week", "Your goals", a food name), while every number that changes
    // as you use the app lives in card CONTENT and stays in Inter with
    // `tabular-nums` — the Fraunces subset has no tabular figures, so digits in
    // it would jitter in width as they update.
    <div
      ref={ref}
      className={cn('font-display text-lg font-semibold leading-none tracking-tight', className)}
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
