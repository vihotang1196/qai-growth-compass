import { cn } from '@/lib/cn';

export type MarkState = 'full' | 'half' | 'empty';

/**
 * 子模块掌握度标记 —— 纯 CSS 方块,不用字符。
 * 理由见 brutalist.css 里 .qai-mark 的注释:用字符就永远在赌字体收录。
 *
 * 分数映射(与 config scoring.submodule_badge 的语义一致):
 *   3 → full(已具备)   2 → half(部分具备)   1 / 0 → empty(缺失)
 */
export function markStateFromScore(score: number): MarkState {
  if (score >= 3) return 'full';
  if (score === 2) return 'half';
  return 'empty';
}

export interface SubmoduleMarkProps {
  state: MarkState;
  /** 无障碍标签,由调用方从 config 的 submodule_badge_legend 取,组件不造文案 */
  label: string;
  className?: string;
}

export function SubmoduleMark({ state, label, className }: SubmoduleMarkProps) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('qai-mark', `qai-mark--${state}`, className)}
    />
  );
}

/** 表头图例。三种状态各一个方块 + 文字,文字由调用方给 */
export function SubmoduleMarkLegend({
  labels,
  className,
}: {
  labels: Record<MarkState, string>;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-4 font-body text-xs', className)}>
      {(['full', 'half', 'empty'] as const).map((s) => (
        <span key={s} className="inline-flex items-center gap-2">
          <SubmoduleMark state={s} label={labels[s]} />
          {labels[s]}
        </span>
      ))}
    </div>
  );
}
