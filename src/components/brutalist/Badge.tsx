import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badge = cva(
  'inline-flex items-center gap-1 border-brutal border-line px-2 py-1 font-head text-[11px] font-bold uppercase leading-none tracking-wider',
  {
    variants: {
      tone: {
        paper: 'bg-paper text-ink',
        muted: 'bg-muted text-ink',
        accent: 'bg-accent text-accent-fg',
        ink: 'bg-ink text-paper',
      },
    },
    defaultVariants: { tone: 'paper' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, ...props }, ref) => (
    <span ref={ref} className={cn(badge({ tone }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';
