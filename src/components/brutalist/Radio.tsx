import { forwardRef } from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@/lib/cn';

export const RadioGroup = forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn('grid gap-3', className)} {...props} />
));
RadioGroup.displayName = 'RadioGroup';

/**
 * 整块可点的选项卡片 —— 答题页每屏 4 个选项就是它。
 * 选中态用黄底 + 加深阴影表达,不引入新色相。
 */
export const RadioCard = forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & { label: string; index?: string }
>(({ className, label, index, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      'qai-lift group flex w-full items-center gap-4 border-brutal border-line bg-paper p-4 text-left',
      'data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg',
      'focus:outline-none focus-visible:shadow-brutal-lg',
      className,
    )}
    {...props}
  >
    <span
      aria-hidden
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center border-brutal border-line',
        'font-head text-sm font-bold',
        'group-data-[state=checked]:bg-ink group-data-[state=checked]:text-paper',
      )}
    >
      {index ?? ''}
    </span>
    <span className="font-body text-base leading-snug">{label}</span>
  </RadioGroupPrimitive.Item>
));
RadioCard.displayName = 'RadioCard';

/** 紧凑型圆点 radio,用于后台筛选器 */
export const RadioDot = forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      'flex h-5 w-5 items-center justify-center border-brutal border-line bg-paper',
      'focus:outline-none focus-visible:shadow-brutal-sm',
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="block h-2.5 w-2.5 bg-ink" />
  </RadioGroupPrimitive.Item>
));
RadioDot.displayName = 'RadioDot';
