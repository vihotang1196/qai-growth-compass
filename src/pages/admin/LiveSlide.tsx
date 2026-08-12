import config from '@/config/assessment-config.json';
import RadarPentagon, { buildRadarAxes } from '@/components/RadarPentagon';
import { useT } from '@/lib/i18n';
import type { UiKey } from '@/config/ui-strings';
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
}: {
  slide: LiveSlideKey;
  aggregate: CohortAggregatePayload;
  /** null = 全部批次 */
  cohortName: string | null;
  isTest: boolean;
}) {
  const { tk, locale } = useT();
  const L = <T,>(zh: T, en: T): T => (locale === 'en' ? en : zh);
  const a = aggregate;

  const dimLabel = (key: string) => {
    const d = DIMENSIONS.find((x) => x.key === key);
    return d ? L(d.zh, d.en) : key;
  };

  /** 计数条 —— 现场只给人数,不给比例。与看板同一条理由,而这里样本更少 */
  const BigBar = ({ label, count, max }: { label: string; count: number; max: number }) => (
    <div className="flex items-center" style={{ gap: '2vmin' }}>
      <span className="shrink-0 text-right font-body" style={{ width: '22vmin', fontSize: '3vmin' }}>
        {label}
      </span>
      <span
        className="bg-accent"
        style={{ height: '5vmin', width: `${max === 0 ? 0 : (count / max) * 100}%`, minWidth: count ? '0.6vmin' : 0 }}
      />
      <span
        className="shrink-0 whitespace-nowrap font-head font-bold"
        style={{ width: '9vmin', fontSize: '3.6vmin' }}
      >
        {count}
      </span>
    </div>
  );

  const tierMax = Math.max(0, ...Object.values(a.tierCounts));
  const weakMax = Math.max(0, ...Object.values(a.weakestCounts));

  return (
    <div className="flex h-full w-full flex-col bg-paper text-ink" style={{ padding: '4vmin' }}>
      {/* 批次名 + 屏名:每一屏都有,因为任何一屏都可能是被投出去的那一屏 */}
      <header className="flex shrink-0 items-baseline justify-between" style={{ gap: '3vmin' }}>
        <h2 className="font-head font-bold uppercase tracking-tight" style={{ fontSize: '4vmin' }}>
          {cohortName ?? tk('live.allCohorts')}
        </h2>
        <span className="font-body opacity-60" style={{ fontSize: '2.4vmin' }}>
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
          style={{ marginTop: '2vmin', padding: '1.4vmin', fontSize: '2.6vmin', letterSpacing: '0.06em' }}
        >
          {tk('live.testBanner')}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col justify-center" style={{ gap: '3vmin' }}>
        {a.n === 0 ? (
          <p className="text-center font-body" style={{ fontSize: '3vmin' }}>
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
            <div className="font-head font-bold leading-none" style={{ fontSize: `${HEADLINE_MAIN_VMIN}vmin` }}>
              {a.averageTotal === null ? '—' : a.averageTotal.toFixed(1)}
            </div>
            <div
              className="font-body uppercase tracking-widest"
              style={{ marginTop: '2vmin', fontSize: '3vmin', opacity: 0.6 }}
            >
              {tk('live.avgTotal')}
            </div>
            <div
              className="font-body"
              style={{ marginTop: '4vmin', fontSize: `${HEADLINE_SUB_VMIN}vmin`, opacity: 0.6 }}
            >
              {tk('live.completedCount').replace('{n}', String(a.n))}
            </div>
          </div>
        ) : slide === 'radar' ? (
          <div className="mx-auto" style={{ width: '62vmin' }}>
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
          <div className="mx-auto w-full" style={{ maxWidth: '86vmin' }}>
            {TIERS.map((t) => (
              <div key={t.key} style={{ marginBottom: '1.6vmin' }}>
                <BigBar label={L(t.zh, t.en)} count={a.tierCounts[t.key] ?? 0} max={tierMax} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto w-full" style={{ maxWidth: '86vmin' }}>
            {DIMENSIONS.map((d) => (
              <div key={d.key} style={{ marginBottom: '1.6vmin' }}>
                <BigBar label={L(d.zh, d.en)} count={a.weakestCounts[d.key] ?? 0} max={weakMax} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
