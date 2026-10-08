import type { CSSProperties } from 'react';
import config from '@/config/assessment-config.json';
import RadarPentagon, { buildRadarAxes } from '@/components/RadarPentagon';
import { useT } from '@/lib/i18n';
import type { UiKey } from '@/config/ui-strings';
import { LIVE_SCALE, scaled } from '@/lib/liveScale';
import type { CohortAggregatePayload } from './CohortDashboard';

const DIMENSIONS = config.dimensions;
const TIERS = config.tiers;
const SCALE = config.meta.score_scale;

/**
 * 四屏,顺序即讲课顺序。**每题选项分布不在里面** ——
 * 那个是课前自己扫的,投出来太密(15 题 × 3~4 个选项,后排看不清)。
 */
export const LIVE_SLIDES = ['headline', 'radar', 'tier', 'weakest'] as const;
export type LiveSlideKey = (typeof LIVE_SLIDES)[number];

/**
 * 第一屏的两个字号 —— **导出是为了让断言引用它们,而不是复制字面量**。
 *
 * 复制一份字面量到测试里,改了代码不改测试时测试仍然绿(而且看起来还在守着)。
 * 断言里真正要钉的是**比值**:主数字必须显著大于辅助行,
 * 否则「两个不同量纲的数看起来同一层级」这个错法会悄悄回来。
 */
export const HEADLINE_MAIN_VMIN = 30;
export const HEADLINE_SUB_VMIN = 3;

/**
 * 现场模式的一屏 —— **纯展示,不取数、不含任何交互**。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【字号按投影距离设计,不按屏幕】所以用 `vmin` 而不是 rem:
 * 全屏之后一个数字占屏高的十分之几,会场后排才看得清。
 * 代价是**一屏只能放三四个数字** —— 那不是妥协,那是这个模块的形态:
 * 投影不是仪表盘,是一次只讲一件事。
 *
 * 【批次名与测试警告出现在**每一屏**,不是第一屏】
 * 任何一屏都可能是被投出去的那一屏 —— 我可能直接跳到第三屏开始讲。
 * 「一条提示条」会被滚出视野,而投影时没人往上滚。
 *
 * 【开放题原文不可能出现在这里,而不是「记得别渲」】
 * 这一屏的数据来自 `cohort_dashboard` 的 `aggregate`,而那个 payload
 * **根本不含 S5/S6** —— 所以「学员写的话被投在屏幕上」在这条路径上不可表示,
 * 不依赖任何人记得。(与 PublicShell 那次同一个取向:让错的状态没有表达方式。)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function LiveSlide({
  slide,
  aggregate,
  cohortName,
  isTest,
  scale = LIVE_SCALE.initial,
}: {
  slide: LiveSlideKey;
  aggregate: CohortAggregatePayload;
  /** null = 全部批次 */
  cohortName: string | null;
  isTest: boolean;
  /**
   * 整体字号,百分比(70–150,默认 100)。讲课的人在现场按 + / − / 0 调,见 `src/lib/liveScale.ts`。
   *
   * 【乘在每一个长度上,不只字号】间距、条形高度、雷达宽度一起变 —— 只放大字的话,
   * 150% 时字会挤出自己的格子。100% 时每一个值都与加这个参数之前逐字相同。
   */
  scale?: number;
}) {
  const { tk, locale } = useT();
  /** 这一屏所有 vmin 长度都经过它 —— 漏掉一处,那一处就不跟着缩放(liveScale.test.ts 逐个比对) */
  const v = (n: number) => scaled(n, scale);
  /** 非 vmin 的长度(rem)同一个系数,三位小数 */
  const r = (rem: number) => `${Math.round(rem * scale * 10) / 1000}rem`;
  const L = <T,>(zh: T, en: T): T => (locale === 'en' ? en : zh);
  const a = aggregate;

  const dimLabel = (key: string) => {
    const d = DIMENSIONS.find((x) => x.key === key);
    return d ? L(d.zh, d.en) : key;
  };

  /**
   * 计数条 —— 现场只给人数,不给比例。与看板同一条理由,而这里样本更少。
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * 【条形装在一条定宽轨道里,数字因此永远在同一个 x】
   * 上一版里条形与计数是**同级**,而条形的宽度是整行的百分比 ——
   * 于是 0 的那几行数字紧贴标签、非 0 的行数字被推到条形末端,x 位置参差。
   * 而这两屏的用途正是**扫一眼看哪一档最多**,数字不成列时那一眼就得来回找。
   *
   * 三段:定宽标签 | `flex-1` 轨道(条形按轨道的百分比伸) | 定宽计数。
   * 百分比因此是相对**轨道**算的,而不是相对整行 —— 顺带修掉了
   * 「100% 的条形会把计数挤出去」这个隐患。
   * ─────────────────────────────────────────────────────────────────────────────
   */
  const BigBar = ({ label, count, max }: { label: string; count: number; max: number }) => (
    <div className="flex items-center" style={{ gap: v(2) }}>
      <span className="shrink-0 text-right font-body" style={{ width: v(22), fontSize: v(3) }}>
        {label}
      </span>
      {/* 轨道:它的存在就是「数字在同一列」这件事的载体 —— 去掉它,x 就又跟着数值跑 */}
      <span className="min-w-0 flex-1">
        <span
          className="block bg-accent"
          style={{
            height: v(5),
            width: `${max === 0 ? 0 : (count / max) * 100}%`,
            minWidth: count ? v(0.6) : 0,
          }}
        />
      </span>
      <span
        className="shrink-0 whitespace-nowrap text-right font-head font-bold"
        style={{ width: v(9), fontSize: v(3.6) }}
      >
        {count}
      </span>
    </div>
  );

  const tierMax = Math.max(0, ...Object.values(a.tierCounts));
  const weakMax = Math.max(0, ...Object.values(a.weakestCounts));

  return (
    <div className="flex h-full w-full flex-col bg-paper text-ink" style={{ padding: v(4) }}>
      {/* 批次名 + 屏名:每一屏都有,因为任何一屏都可能是被投出去的那一屏 */}
      <header className="flex shrink-0 items-baseline justify-between" style={{ gap: v(3) }}>
        <h2 className="font-head font-bold uppercase tracking-tight" style={{ fontSize: v(4) }}>
          {cohortName ?? tk('live.allCohorts')}
        </h2>
        {/*
          屏名不换行、不被挤:放大到 150% 时在 4:3 屏上,长批次名会把它挤成「最弱维度分 / 布」。
          要换行的只能是批次名(它在左边,换在词与词之间)。100% 时任何分辨率都放得下,不受影响。
        */}
        <span className="shrink-0 whitespace-nowrap font-body opacity-60" style={{ fontSize: v(2.4) }}>
          {tk(`live.slide.${slide}` as UiKey)}
        </span>
      </header>

      {/*
        测试批次的警告 —— 比看板那条强得多:满宽、墨底反白、每一屏都在。
        看板是一个人看,现场模式是当着所有人讲一组数字,而讲错了不可逆。
      */}
      {isTest && (
        <div
          className="shrink-0 bg-ink text-center font-head font-bold uppercase text-paper"
          style={{ marginTop: v(2), padding: v(1.4), fontSize: v(2.6), letterSpacing: '0.06em' }}
        >
          {tk('live.testBanner')}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col justify-center" style={{ gap: v(3) }}>
        {a.n === 0 ? (
          <p className="text-center font-body" style={{ fontSize: v(3) }}>
            {tk('live.empty')}
          </p>
        ) : slide === 'headline' ? (
          /*
            ─────────────────────────────────────────────────────────────────────
            【一个主数字,人数降级成小字】
            上一版把人数与平均分**同尺寸并排**(两个 22vmin),于是
            「1」和「4.3」被读成了「14.3」—— 第一眼就读错,而这一屏是投给一屋子人的,
            读错的成本是讲课的人要停下来解释。

            根因不是间距不够,是**两个量纲不同的数被排成了同一层级**:
            人数是背景信息,平均分才是全场关心的那个数字。
            所以不是「把间距拉大」,是把层级分开 —— 拉间距只是让同一个错法更难触发。

            【标签夹在两个数字中间,不是紧挨着】顺序是
            主数字 → 「平均总分」→ 「N 人已完成」。
            两串数字之间永远隔着一行文字,所以连缀读法在**布局上**就不成立。

            【小字里没有「本批」】用户给的措辞是「本批 1 人已完成」,但这一屏
            也可能是「全部批次」范围 —— 那时「本批」是错的。而范围已经写在标题上了,
            所以这一行只说「N 人已完成」。
            ─────────────────────────────────────────────────────────────────────
          */
          <div className="text-center">
            <div className="font-head font-bold leading-none" style={{ fontSize: v(HEADLINE_MAIN_VMIN) }}>
              {a.averageTotal === null ? '—' : a.averageTotal.toFixed(1)}
            </div>
            <div
              className="font-body uppercase tracking-widest"
              style={{ marginTop: v(2), fontSize: v(3), opacity: 0.6 }}
            >
              {tk('live.avgTotal')}
            </div>
            <div
              className="font-body"
              style={{ marginTop: v(4), fontSize: v(HEADLINE_SUB_VMIN), opacity: 0.6 }}
            >
              {tk('live.completedCount').replace('{n}', String(a.n))}
            </div>
          </div>
        ) : slide === 'radar' ? (
          /*
            【雷达组件是报告页的,带着两样不跟 vmin 走的尺寸】figure 上的 `max-w-xl`(36rem = 576px)
            与图例的 `text-xs`(12px)。只缩放 vmin 的话,1920×1080 上按 + 雷达纹丝不动(早就被 576px 卡住),
            图例在任何比例下都是 12px。所以这里把那个上限挪到外层、乘上同一个系数,图例字号也一样 ——
            100% 时宽度仍是 min(62vmin, 36rem)、图例仍是 0.75rem,与加缩放之前逐像素相同。
            只在这一层用后代选择器改,不动 RadarPentagon 本身(报告与分享卡也用它)。
          */
          <div
            className="mx-auto [&_figcaption]:text-[length:var(--live-legend)] [&_figure]:max-w-none"
            style={{ width: `min(${v(62)}, ${r(36)})`, '--live-legend': r(0.75) } as CSSProperties}
          >
            <RadarPentagon
              axes={buildRadarAxes(DIMENSIONS, a.dimensionMeans, {}, dimLabel)}
              scale={SCALE}
              selfLabel={tk('live.slide.radar')}
              baselineLabel=""
              baselineN={1}
              noBaselineLabel=""
            />
          </div>
        ) : slide === 'tier' ? (
          <div className="mx-auto w-full" style={{ maxWidth: v(86) }}>
            {TIERS.map((t) => (
              <div key={t.key} style={{ marginBottom: v(1.6) }}>
                <BigBar label={L(t.zh, t.en)} count={a.tierCounts[t.key] ?? 0} max={tierMax} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto w-full" style={{ maxWidth: v(86) }}>
            {DIMENSIONS.map((d) => (
              <div key={d.key} style={{ marginBottom: v(1.6) }}>
                <BigBar label={L(d.zh, d.en)} count={a.weakestCounts[d.key] ?? 0} max={weakMax} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
