/**
 * 生成中的动画 —— 五边形五条边依次描出来。
 *
 * 【为什么不用通用 spinner】复用报告页的视觉母题(五边形 = 五维罗盘),比一个转圈更贴;
 * Brutalist 的硬边也适合几何动画,渐变圆形 spinner 与整套语言冲突。
 *
 * ⚠️【动画是纯装饰,绝不参与 __REPORT_READY__】那个信号由数据到达 + 渲染完成决定。
 * 若让动画影响它,Stage 9 的 PDF 会截到动画中间的帧 —— 一份画了一半的雷达图。
 * 所以这个组件只在 loading 态出现,报告态根本不 mount。
 */
const SIZE = 120;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 44;

function vertex(i: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
  return [CX + R * Math.cos(a), CY + R * Math.sin(a)];
}

export default function PentagonLoader({ label }: { label: string }) {
  const pts = Array.from({ length: 5 }, (_, i) => vertex(i));

  return (
    <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-hidden>
        {/* 底稿:完整五边形,浅墨 */}
        <polygon
          points={pts.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke="var(--line, #1a1a1a)"
          strokeOpacity={0.15}
          strokeWidth={2}
        />
        {/* 五条边依次描出:每条边一个 line,用 dash 走一圈,错开 delay */}
        {pts.map((p, i) => {
          const q = pts[(i + 1) % 5];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          return (
            <line
              key={i}
              x1={p[0]}
              y1={p[1]}
              x2={q[0]}
              y2={q[1]}
              stroke="var(--ink, #1a1a1a)"
              strokeWidth={3}
              strokeLinecap="square"
              strokeDasharray={len}
              className="qai-pentagon-edge"
              // dashoffset 起点必须等于该边长度,否则短边会「提前画完」看起来不齐
              style={{ animationDelay: `${i * 0.18}s`, strokeDashoffset: len, ['--qai-dash' as string]: String(len) }}
            />
          );
        })}
        {/* 顶点方块,同一节奏亮起 */}
        {pts.map((p, i) => (
          <rect
            key={`v${i}`}
            x={p[0] - 3.5}
            y={p[1] - 3.5}
            width={7}
            height={7}
            fill="var(--accent, #f2c200)"
            stroke="var(--ink, #1a1a1a)"
            strokeWidth={1.5}
            className="qai-pentagon-vertex"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </svg>
      <p className="font-body text-sm opacity-70">{label}</p>
    </div>
  );
}
