import { cn } from '@/lib/cn';

export type MarkState = 'full' | 'half' | 'empty';

/**
 * 子模块掌握度标记 —— 纯 CSS 方块,不用字符。
 * 理由见 brutalist.css 里 .qai-mark 的注释:用字符就永远在赌字体收录。
 */

/**
 * ⚠️ v2 遗留,只有 Showcase 演示页在用。**Stage 8 报告页不要用它。**
 *
 * 它按 option_index(0–3)判定,而 v3 计分改成了每题按 option_count 归一化 ——
 * index 2 在 3 选项题是满分 5.0、在 4 选项题只有 3.33,用 option_index 判会把一批
 * 「已具备」错标成「部分具备」。v3 的真值是 `scoring.badgeForScore(归一化分, scale)`,
 * 返回 'full' | 'partial' | 'missing'。渲染时把 partial↔half、missing↔empty 对上即可
 * (两处词汇不同是历史原因,Stage 8 接线时统一)。
 *
 * 留着不删是因为 Showcase 还在用它演示三种方块;等 Stage 8 把报告接上 badgeForScore
 * 之后,这个函数和 Showcase 的那处调用可以一起删。
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
