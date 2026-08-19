import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '#app/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-red-500/50 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 [&>svg]:text-current',
        // "On track" / "over" alert-level counterparts to the Badge variants above —
        // same green/amber pair, same DESIGN.md §3/§7 rule (amber, never red, for
        // "over goal").
        success: 'border-green-500/50 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 [&>svg]:text-current',
        warning:
          'border-accent-amber-border bg-accent-amber-surface text-accent-amber [&>svg]:text-current',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-title" className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
