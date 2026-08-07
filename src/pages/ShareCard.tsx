import { useCallback, useEffect, useState } from 'react';
import config from '@/config/assessment-config.json';
import RadarPentagon, { buildRadarAxes } from '@/components/RadarPentagon';
import { useT } from '@/lib/i18n';
import { fetchReport, type ReportPayload } from '@/lib/reportApi';
// 尺寸与元素 id 的真相源在 api/_lib —— 截图器也从那里读,两边不会各写一份
import { SHARE_CARD_SIZES } from '../../api/_lib/shareCard';

declare global {
  interface Window {
    /** 截图器等这个信号 —— 与报告页的 __REPORT_READY__ 同一个取向,不靠 sleep */
    __CARD_READY__?: boolean;
  }
}

const DIMENSIONS = config.dimensions;
const TIER_BY_KEY = new Map(config.tiers.map((t) => [t.key, t]));
const SCALE = config.meta.score_scale;
const [SQUARE, TALL] = SHARE_CARD_SIZES;


/**
 * 分享卡页 —— **只给截图器看,不是给人看的路由**。
 *
 * 【放什么、不放什么,是这个页面唯一重要的决定】
 *   放:总分、档位名、五边形的形状、品牌标识
 *   不放:五个维度的具体分数、维度名、最弱维度、任何金额、任何他自己填的内容
 *
 * 不放具体分数是因为**那些是诊断,诊断不该被公开对照**。而形状本身有辨识度又不精确 ——
 * 那正是分享卡该有的信息密度:好看、可辨识、但不构成对他公司的公开评估。
 * 往上加任何一维的分数,这张卡就从「我测了个好玩的」变成「我把体检报告贴出来了」,
 * 而后者没人愿意发。
 *
 * 【为什么单独一个路由而不是在报告页里藏一块】藏在报告页里的话,那块 DOM 会跟着
 * 进 PDF 的打印流(或者要再加一条 print 隐藏规则去防它),而报告页本身已经九个板块了。
 * 单独一页的代价只是截图时多一次 page.goto(约 1–2 秒,同一个浏览器实例内)。
 */
export default function ShareCard() {
  const [data, setData] = useState<ReportPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchReport()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (data) window.__CARD_READY__ = true;
    return () => {
      window.__CARD_READY__ = false;
    };
  }, [data]);

  if (failed) return <div>error</div>;
  if (!data) return null;
  return <ShareCardView result={data.result} />;
}

/**
 * 卡面本身 —— **纯展示,不取数**。
 *
 * 【为什么与取数分开】这个功能最重要的一条断言是「卡上【没有】什么」,
 * 而页面组件在 SSR 下只渲得出 null(数据是 useEffect 拉的)。
 * 拆开之后那条断言才能落在真实的卡面标记上,而不是测试里另写一份副本
 * (判断标准 4 与 8)。隐私是这张卡唯一不能出错的地方,它必须可断言。
 */
export function ShareCardView({ result }: { result: ReportPayload['result'] }) {
  const { tk, locale } = useT();
  const L = useCallback(<T,>(zh: T, en: T): T => (locale === 'en' ? en : zh), [locale]);

  const { total, tier: tierKey, dimensions } = result;
  const tier = TIER_BY_KEY.get(tierKey);
  const tierName = tier ? L(tier.zh, tier.en) : tierKey;
  const brand = L(config.meta.name_zh, config.meta.name_en);
  /**
   * 【基准线传 n=1,所以画不出来】分享卡上不该有对比 —— 那是报告里的东西。
   * 不需要为此加新开关:baselineN < 2 时组件本来就不画基准。
   */
  const axes = buildRadarAxes(DIMENSIONS, dimensions, {}, (k) => k);

  const Pentagon = ({ size }: { size: number }) => (
    <div style={{ width: size, height: size }}>
      <RadarPentagon
        axes={axes}
        scale={SCALE}
        selfLabel={brand}
        baselineLabel=""
        baselineN={1}
        noBaselineLabel=""
        bare
      />
    </div>
  );

  const Score = ({ big, small }: { big: number; small: number }) => (
    <div className="text-center">
      <div className="font-body uppercase tracking-[0.2em]" style={{ fontSize: small, opacity: 0.6 }}>
        {tk('card.scoreLabel')}
      </div>
      <div className="font-head font-bold leading-none" style={{ fontSize: big }}>
        {total.toFixed(1)}
        <span style={{ fontSize: big * 0.32, opacity: 0.45 }}> / {SCALE.toFixed(1)}</span>
      </div>
    </div>
  );

  const Tier = ({ pad, size }: { pad: number; size: number }) => (
    <div
      className="border-brutal border-line bg-accent font-head font-bold text-accent-fg"
      style={{ padding: `${pad * 0.5}px ${pad}px`, fontSize: size }}
    >
      {tierName}
    </div>
  );

  const Brand = ({ size }: { size: number }) => (
    <div className="font-head font-bold uppercase" style={{ fontSize: size, letterSpacing: '0.08em' }}>
      {brand}
    </div>
  );

  return (
    /**
     * 两张卡都渲在同一页上,截图器按 id 取元素分别截 —— 一次 page.goto 出两张。
     * 页面本身不居中、不留白:元素的边界就是图片的边界。
     */
    <div className="bg-paper text-ink">
      <div
        id={SQUARE.id}
        className="flex flex-col items-center justify-between bg-paper"
        style={{ width: SQUARE.w, height: SQUARE.h, padding: 72 }}
      >
        <Brand size={34} />
        <Pentagon size={560} />
        <div className="flex flex-col items-center" style={{ gap: 28 }}>
          <Score big={150} small={26} />
          <Tier pad={34} size={40} />
        </div>
      </div>

      <div
        id={TALL.id}
        className="flex flex-col items-center justify-between bg-paper"
        style={{ width: TALL.w, height: TALL.h, padding: 96 }}
      >
        <Brand size={40} />
        <Pentagon size={760} />
        <div className="flex flex-col items-center" style={{ gap: 40 }}>
          <Score big={210} small={32} />
          <Tier pad={44} size={52} />
        </div>
        <div className="font-body" style={{ fontSize: 28, opacity: 0.55 }}>
          {tk('card.cta')}
        </div>
      </div>
    </div>
  );
}
