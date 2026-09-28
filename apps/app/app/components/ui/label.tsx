import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '#app/lib/utils';

// `block`, because a Radix label renders an inline `<label>` and an inline
// element takes no margin from the `space-y-*` wrapper almost every form in
// this app puts it in: the promised 8 px gap was drawing as 3 px everywhere,
// and a short label shared a line with the field it names.
const labelVariants = cva(
  'block text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
