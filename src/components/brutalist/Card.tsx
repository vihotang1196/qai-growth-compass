import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const card = cva('border-brutal border-line', {
  variants: {
    tone: {
      paper: 'bg-paper text-ink',
      muted: 'bg-muted text-ink',
      accent: 'bg-accent text-accent-fg',
      ink: 'bg-ink text-paper',
    },
    shadow: {
      none: '',
      base: 'qai-slab',
      lg: 'shadow-brutal-lg',
      lift: 'qai-lift',
    },
    padding: { none: 'p-0', sm: 'p-4', md: 'p-6', lg: 'p-8' },
  },
  defaultVariants: { tone: 'paper', shadow: 'base', padding: 'md' },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof card> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, tone, shadow, padding, ...props }, ref) => (
    <div ref={ref} className={cn(card({ tone, shadow, padding }), className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mb-4 flex items-start justify-between gap-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('font-head text-lg font-bold uppercase tracking-wide', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardBody = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('font-body text-sm leading-relaxed', className)} {...props} />
  ),
);
CardBody.displayName = 'CardBody';
