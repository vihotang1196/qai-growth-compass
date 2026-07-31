import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/** 外层负责横向滚动 —— 名单页列很多,手机上不能撑破页面 */
export const TableWrap = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('w-full overflow-x-auto border-brutal border-line bg-paper', className)}
      {...props}
    />
  ),
);
TableWrap.displayName = 'TableWrap';

export const Table = forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table
      ref={ref}
      className={cn('w-full border-collapse font-body text-sm', className)}
      {...props}
    />
  ),
);
Table.displayName = 'Table';

export const Thead = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('bg-ink text-paper', className)} {...props} />
  ),
);
Thead.displayName = 'Thead';

export const Tbody = forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={className} {...props} />,
);
Tbody.displayName = 'Tbody';

export const Th = forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'whitespace-nowrap px-4 py-3 text-left font-head text-xs font-bold uppercase tracking-wider',
        className,
      )}
      {...props}
    />
  ),
);
Th.displayName = 'Th';

export interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** 号码格式异常等需要人工处理的行,标红 —— 用墨底反白,不引入红色 */
  flagged?: boolean;
}

export const Tr = forwardRef<HTMLTableRowElement, TrProps>(
  ({ className, flagged, ...props }, ref) => (
    <tr
      ref={ref}
      data-flagged={flagged || undefined}
      className={cn(
        'border-t-brutal border-line-soft',
        flagged && 'bg-accent',
        className,
      )}
      {...props}
    />
  ),
);
Tr.displayName = 'Tr';

export const Td = forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('whitespace-nowrap px-4 py-3 align-middle', className)} {...props} />
  ),
);
Td.displayName = 'Td';
