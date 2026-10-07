import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { useDelayedFlag } from '@/lib/useBusy';

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
  /**
   * 按下之后在等服务器。立刻:保持压下去的样子、再按无效;等满 150ms:换成转圈 + `busyLabel`。
   * 【不用 disabled】disabled 是「现在不能按」的灰,按下去那一瞬间整个按钮变灰,看起来像出错;
   * 而这里要说的是「收到了,在办」。防重复点击的真正闸门在调用方的 useSingleFlight(同步挡)。
   */
  busy?: boolean;
  /** 等待超过 150ms 时显示的文字;不给就沿用按钮原文 */
  busyLabel?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, asChild, busy = false, busyLabel, children, onClick, ...props }, ref) => {
    const loading = useDelayedFlag(busy);
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(button({ variant, size, block }), className)}
        aria-busy={busy || undefined}
        data-busy={busy ? '' : undefined}
        // 等待中的点击(含表单提交)一律吞掉
        onClick={busy ? (e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault() : onClick}
        {...props}
      >
        {loading && !asChild ? (
          <>
            <span aria-hidden className="qai-spinner inline-block h-3 w-3 shrink-0 border-2 border-current" />
            {busyLabel ?? children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
