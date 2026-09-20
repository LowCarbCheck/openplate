import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '#app/lib/utils';

/**
 * THE CONTROL STAYS SMALL, THE TARGET DOES NOT. A 32 x 18 px switch is the
 * drawing this app wants; a 32 x 18 px tap target is not. The `after:` square
 * is an invisible 44 px hit area centred on the track, so a thumb landing
 * anywhere near the switch reaches it and nothing on the page moves.
 *
 * THE UNCHECKED TRACK GETS A BORDER, not a darker fill. `--input` on a white
 * card measured 1.38:1, under WCAG 1.4.11's 3:1 floor for a control boundary,
 * and filling the track with a mid grey would make "off" read as "on". The
 * border is already in the box model (it was transparent), so the switch is
 * the same size it always was.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative data-[state=checked]:bg-primary data-[state=unchecked]:bg-input data-[state=unchecked]:border-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
