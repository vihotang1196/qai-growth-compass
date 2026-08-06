/**
 * 五边形雷达图 —— 手写 SVG,不装 recharts。
 *
 * 【为什么手写】省一个依赖;而且 Stage 9 的 PDF 渲染要等 window.__REPORT_READY__,
 * SVG 同步渲染,mount 完就画完,那个信号好埋 —— 异步图表库会让「图画完了吗」变难判断。
 *
 * 两条线:本人(黄,accent)+ 基准(墨,ink 虚线)。维度色【不】画在雷达线上 ——
 * 只在轴标签旁做一个带墨边框的小方块(check:dim 的规矩:维度色仅作带边框填充)。
 */

export interface RadarAxis {
  key: string;
  label: string;
  color: string;
  /** 本人得分 0–scale */
  value: number;
  /** 基准得分 0–scale */
  baseline: number;
}

/**
 * 从「本人分数 + 基准均值 + 维度表」构造轴数组 —— **唯一一份实现**。
 *
 * 【为什么必须导出而不是在页面里内联】上一轮的不变量断言在测试里【重写】了一份同样的
 * 构造逻辑,于是它守的是自己那份副本,不是生产路径:两份今天恰好等价,断言绿着,
 * 而线上仍然出错。一条绿着的断言守着一个正在出错的行为,比没有断言更危险 ——
 * 它让下一个人以为这块验过了。所以现在只有这一份,页面和测试都调它。
 */
export function buildRadarAxes(
  dimensions: readonly { key: string; color: string }[],
  mine: Record<string, number>,
  baselineMeans: Record<string, number>,
  labelOf: (key: string) => string,
): RadarAxis[] {
  return dimensions.map((d) => ({
    key: d.key,
    label: labelOf(d.key),
    color: d.color,
    value: mine[d.key] ?? 0,
    baseline: baselineMeans[d.key] ?? 0,
  }));
}

const SIZE = 320;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 110; // 顶格半径

/** 第 i 个轴的角度(从正上方开始,顺时针) */
function angleFor(i: number, n: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / n;
}

function point(i: number, n: number, radius: number): [number, number] {
  const a = angleFor(i, n);
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}

/**
 * 值数组 → SVG points 字符串。导出是为了能单独测:
 * 「n=1 时本人与基准两个多边形必须逐点相等」那条不变量要在这里断言。
 */
export function polygonPoints(values: number[], scale: number): string {
  return values
    .map((v, i) => point(i, values.length, (Math.max(0, Math.min(scale, v)) / scale) * R).join(','))
    .join(' ');
}

export default function RadarPentagon({
  axes,
  scale,
  selfLabel,
  baselineLabel,
  baselineN,
  noBaselineLabel,
}: {
  axes: RadarAxis[];
  scale: number;
  selfLabel: string;
  baselineLabel: string;
  /** 基准的样本数。< 2 时基准就是本人,画出来只会误导 —— 不画 */
  baselineN: number;
  /** 不画基准时的说明 */
  noBaselineLabel: string;
}) {
  /**
   * 【n < 2 不画基准线】样本只有本人时,基准均值【定义上】等于本人分数,两条线完全重合。
   * 画出来不但零信息,还会让人以为「有对比」;而一旦它与旁边的网格环混淆,
   * 人会把满格网格读成基准,得出「基准比我高很多」的错误结论 —— 实测就发生了这一次。
   */
  const showBaseline = baselineN >= 2;
  const n = axes.length;
  const rings = Array.from({ length: scale }, (_, k) => k + 1); // 1..scale 同心五边形

  return (
    <figure className="mx-auto w-full max-w-sm">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" role="img" aria-label={selfLabel}>
        {/* 网格:每一分一圈同心五边形 */}
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, i) => point(i, n, (ring / scale) * R).join(',')).join(' ')}
            fill="none"
            stroke="var(--line, #1a1a1a)"
            /**
             * 【网格一律淡,包括最外圈】原来最外圈是 opacity 0.9 / 2px 的深墨满格五边形,
             * 与基准虚线(同为深墨)在视觉上难以区分 —— 实测中它被当成了基准线,
             * 而真正的基准恰好与本人重合、压在黄边下看不见。网格是背景,不能与数据竞争。
             */
            strokeOpacity={ring === scale ? 0.3 : 0.12}
            strokeWidth={1}
          />
        ))}
        {/* 轴线 */}
        {axes.map((_, i) => {
          const [x, y] = point(i, n, R);
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--line, #1a1a1a)" strokeOpacity={0.2} />;
        })}

        {/* 基准线:墨色虚线,无填充。样本 < 2 时不画(见 showBaseline) */}
        {showBaseline && (
          <polygon
            points={polygonPoints(axes.map((a) => a.baseline), scale)}
            fill="none"
            stroke="var(--ink, #1a1a1a)"
            strokeWidth={2.5}
            strokeDasharray="6 4"
          />
        )}
        {/* 本人:黄底半透明 + 墨边 */}
        <polygon
          points={polygonPoints(axes.map((a) => a.value), scale)}
          fill="var(--accent, #f2c200)"
          fillOpacity={0.35}
          stroke="var(--ink, #1a1a1a)"
          strokeWidth={2.5}
        />
      </svg>

      {/* 轴标签 + 维度色方块(色只在这里,不在线上) */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
        {axes.map((a) => (
          <div key={a.key} className="flex items-center gap-2 font-body">
            <span
              className="h-3 w-3 shrink-0 border-brutal border-line"
              style={{ backgroundColor: a.color }}
              aria-hidden
            />
            <span className="truncate">{a.label}</span>
            <span className="ml-auto font-head font-bold">{a.value.toFixed(1)}</span>
          </div>
        ))}
      </div>

      {/* 图例 */}
      <figcaption className="mt-3 flex justify-center gap-5 font-body text-xs opacity-70">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-5 bg-accent" aria-hidden /> {selfLabel}
        </span>
        {showBaseline ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-5 border-t-2 border-dashed border-line" aria-hidden /> {baselineLabel}
          </span>
        ) : (
          <span>{noBaselineLabel}</span>
        )}
      </figcaption>
    </figure>
  );
}
