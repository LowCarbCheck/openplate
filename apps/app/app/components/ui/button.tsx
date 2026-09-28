import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '#app/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // PHONE FIRST, DESKTOP UNCHANGED. Every size draws a 44 px target below
      // `md`, which is the floor a thumb needs, and falls back to the desktop
      // scale above it. The whole scale moved rather than the default alone:
      // `sm` and `icon-sm` are what dense rows reach for, and a 32 px button
      // beside a destructive one is where a mis-tap costs data.
      size: {
        default: 'h-11 px-4 py-2 has-[>svg]:px-3 md:h-9',
        sm: 'h-11 gap-1.5 px-3 has-[>svg]:px-2.5 md:h-8',
        lg: 'h-12 px-6 has-[>svg]:px-4 md:h-10',
        icon: 'size-11 md:size-9',
        'icon-sm': 'size-11 md:size-8',
        'icon-lg': 'size-12 md:size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  // `data-size` mirrors `ui/select`'s trigger: a size is the one thing about a
  // button a layout check needs to name, and reading it off the class list
  // would be reading the answer out of the question.
  return (
    <Comp
      data-slot="button"
      data-size={size ?? 'default'}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
