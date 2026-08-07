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
 *
 * 【不再带 color】标签移进 SVG 之后,雷达里没有任何东西用维度色 ——
 * 数据线是黄 + 墨,顶点旁只有文字。颜色与维度的对应由紧邻的「每一维为什么是这个分」
 * 板块建立(那里每个维度名旁都有带墨边框的小方块)。留一个没人读的字段,
 * 下一个人会以为雷达用得上它。
 */
export function buildRadarAxes(
  dimensions: readonly { key: string }[],
  mine: Record<string, number>,
  baselineMeans: Record<string, number>,
  labelOf: (key: string) => string,
): RadarAxis[] {
  return dimensions.map((d) => ({
    key: d.key,
    label: labelOf(d.key),
    value: mine[d.key] ?? 0,
    baseline: baselineMeans[d.key] ?? 0,
  }));
}

/**
 * viewBox 是【宽 > 高】的:五个顶点标签移进 SVG 之后,左右两侧各要留出一整条标签的宽度,
 * 而上下只需要一行多一点。英文维度名最长是 "Drive Conversion"(16 字符,13px 下约 110 单位),
 * 右侧顶点的锚点已经在 CX+121.7 —— 520 的宽度是按这个最坏情况定的,不是随手取的。
 */
const VIEW_W = 520;
const VIEW_H = 330;
const CX = VIEW_W / 2;
const CY = 172;
const R = 110; // 顶格半径
/** 标签锚点的半径 —— 比顶格再往外 18,免得压在数据线上 */
const LABEL_R = R + 18;

/** 第 i 个轴的角度(从正上方开始,顺时针) */
function angleFor(i: number, n: number): number {
  return -Math.PI / 2 + (i * 2 * Math.PI) / n;
}

function point(i: number, n: number, radius: number): [number, number] {
  const a = angleFor(i, n);
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}

export interface RadarLabelAnchor {
  /** 锚点坐标(SVG 用户单位,与图形同一套坐标系) */
  x: number;
  y: number;
  textAnchor: 'start' | 'middle' | 'end';
  /** 维度名那一行相对锚点的基线偏移 */
  dyLabel: number;
  /** 分数那一行 */
  dyValue: number;
}

/** 两行之间的行距 */
const LABEL_LINE = 15;

/**
 * 五个顶点各自的标签锚点 —— **角度从 `point()` 取,不另起一套计算**。
 *
 * 【为什么强调这一句】雷达这块栽过三轮,第一轮就是测试自己重写了一份轴构造,
 * 两份恰好等价所以断言绿着,而生产路径根本没被测到(见判断标准 4 与 8)。
 * 标签位置只要有第二处角度计算,同样的事就会再发生一次。
 *
 * 【为什么按象限分三档,而不是统一偏移】五个顶点里有两个在下方(五边形底边两侧)、
 * 两个在侧面、一个在正上方。统一给一个偏移,下方那两个会压到图形上。
 * 判据取顶点单位向量:
 *   * 水平 —— cos 决定文字往哪边展开(右侧 start / 左侧 end / 正上方 middle);
 *   * 垂直 —— sin 决定两行文字整体在顶点的上方、侧旁还是下方。
 * 阈值 0.5 而不是 0:侧面那两个顶点的 sin 是 ∓0.309,把它们归进「上方 / 下方」
 * 会让文字斜着飘离顶点。
 *
 * ⚠️ **是否真的没压到图形,只能部署后看图确认** —— 本地断言只能验坐标和 anchor 值,
 * 验不了「字形的实际墨迹有没有和线重叠」。见判断标准 4 的后半条。
 */
export function buildLabelAnchors(n: number): RadarLabelAnchor[] {
  return Array.from({ length: n }, (_, i) => {
    const a = angleFor(i, n);
    const [x, y] = point(i, n, LABEL_R);
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    const textAnchor: RadarLabelAnchor['textAnchor'] =
      Math.abs(cos) < 0.05 ? 'middle' : cos > 0 ? 'start' : 'end';

    // 上方:两行都要抬到顶点之上;下方:两行都压到顶点之下;侧面:两行夹住顶点
    const dyLabel = sin < -0.5 ? -10 - LABEL_LINE : sin > 0.5 ? 14 : -1;

    return { x, y, textAnchor, dyLabel, dyValue: dyLabel + LABEL_LINE };
  });
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

  const labelAnchors = buildLabelAnchors(n);

  return (
    /**
     * max-w 从 sm 放到 xl:viewBox 变宽(左右要装下标签)之后,同样的容器宽度会把
     * 五边形本身缩小。放宽容器让图形回到原来的视觉尺寸,多出来的是标签占的地方。
     */
    <figure className="mx-auto w-full max-w-xl">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full" role="img" aria-label={selfLabel}>
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

        {/*
          轴标签:维度名 + 分数,画在【SVG 内】的五个顶点旁。

          【为什么是 <text> 而不是 HTML overlay】PDF 走 page.pdf(),HTML 定位的元素
          在打印时可能与图形错位;SVG 内的文本跟着图形一起缩放,两者不可能走散。

          【不再有维度色小方块】原来图下方那排列表里有,但雷达【本身不用维度色】
          (数据线是黄 + 墨),那些方块在这张图里没有对应物。而紧邻的「每一维为什么是
          这个分」板块里,每个维度名旁就带着同样的方块 —— 颜色与维度的对应在那里建立。
          搬到顶点旁再放一遍,只会让辅助元素跟数据线抢视觉权重(设计系统铁律 2)。

          【opacity 0.75】同一条铁律:标签是辅助元素。压一档让黄面与墨线仍是最先看到的东西。
        */}
        <g className="font-body" fontSize={14} opacity={0.75}>
          {axes.map((a, i) => {
            const anchor = labelAnchors[i];
            return (
              <text key={a.key} x={anchor.x} y={anchor.y} textAnchor={anchor.textAnchor}>
                <tspan x={anchor.x} dy={anchor.dyLabel}>
                  {a.label}
                </tspan>
                <tspan x={anchor.x} dy={anchor.dyValue - anchor.dyLabel} className="font-head" fontWeight="bold">
                  {a.value.toFixed(1)}
                </tspan>
              </text>
            );
          })}
        </g>
      </svg>

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
