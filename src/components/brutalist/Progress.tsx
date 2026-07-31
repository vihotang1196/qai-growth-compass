import { forwardRef } from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/cn';

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  /** 0–100 */
  value?: number;
  /** 右上角的 "第 3 / 24 题" 之类文字,由调用方从 ui-strings 取,组件不造文案 */
  caption?: string;
}

export const Progress = forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value = 0, caption, ...props }, ref) => {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="w-full">
      {caption && (
        <div className="mb-2 flex justify-between font-head text-xs font-bold uppercase tracking-wider">
          <span>{caption}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      )}
      <ProgressPrimitive.Root
        ref={ref}
        value={pct}
        className={cn('h-5 w-full overflow-hidden border-brutal border-line bg-paper', className)}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className="h-full bg-accent transition-[width] duration-brutal ease-out"
          style={{ width: `${pct}%` }}
        />
      </ProgressPrimitive.Root>
    </div>
  );
});
Progress.displayName = 'Progress';
