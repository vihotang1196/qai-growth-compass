import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const button = cva(
  'qai-lift inline-flex items-center justify-center gap-2 border-brutal border-line font-head font-bold uppercase tracking-wide select-none disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg',
        solid: 'bg-ink text-paper',
        outline: 'bg-paper text-ink',
        ghost: 'bg-muted text-ink',
      },
      size: {
        sm: 'h-9 px-3 text-xs',
        md: 'h-12 px-5 text-sm',
        lg: 'h-14 px-8 text-base',
        icon: 'h-12 w-12 p-0',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /** 渲染成子元素(比如 <a>),保留全部样式 */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(button({ variant, size, block }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
