import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, CardBody } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { adminPost } from '@/lib/adminApi';
import LiveSlide, { LIVE_SLIDES } from './LiveSlide';
import type { DashboardPayload } from './CohortDashboard';

/**
 * 现场模式。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【复用 cohort_dashboard,不新建 action】那个 payload 已经有全部要的东西,
 * 而且**它根本不含开放题** —— 所以「学员写的话被投在屏幕上」在这条路径上
 * 不可表示,不靠渲染时记得。数据源就是那条约束的执行者。
 *
 * 【绝不自动切屏】没有 setInterval、没有计时器。
 * 自动轮播会在讲一半的时候把画面换走 —— 而讲的人没法把它拨回来继续讲同一句话。
 * 切屏只有两个来源:方向键、按钮。
 *
 * 【全屏投的是 slideRef 那一个元素,不是整页】
 * 浏览器地址栏、标签页、Admin 的导航都在那个元素之外,所以它们**不可能**进投影 ——
 * 与分享卡截进 EN 按钮是同一类问题,而这次的观众是一屋子人。
 * 解法同样是结构性的(把要投的东西放进一个自己的元素),不是「记得隐藏导航」。
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function LiveMode({ onAuthLost }: { onAuthLost: (forbidden: boolean) => void }) {
  const { tk } = useT();
  const [scope, setScope] = useState('all');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [isFull, setIsFull] = useState(false);
  const slideRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (target: string) => {
      setNotice(null);
      try {
        setData(await adminPost<DashboardPayload>('cohort_dashboard', { cohort_id: target }));
      } catch (err) {
        if (err instanceof Error && (err.message === 'unauthorized' || err.message === 'forbidden')) {
          onAuthLost(err.message === 'forbidden');
          return;
        }
        setNotice(err instanceof Error ? err.message : String(err));
      }
    },
    [onAuthLost],
  );

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  /** 只有方向键会切屏 —— 没有任何计时器 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(LIVE_SLIDES.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 用 ESC 退出全屏时浏览器不会通知我们,所以监听 fullscreenchange 而不是只记自己的状态
  useEffect(() => {
    const sync = () => setIsFull(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (slideRef.current) await slideRef.current.requestFullscreen();
    } catch (err) {
      // 浏览器可能拒绝(非用户手势 / 权限),说出来而不是静默什么都没发生
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  if (notice) {
    return (
      <Card padding="md">
        <CardBody className="font-body text-sm">{notice}</CardBody>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card padding="md">
        <CardBody>{tk('common.loading')}</CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 控制条 —— 它在 slideRef 之外,所以不会进投影 */}
      <Card padding="sm">
        <CardBody className="flex flex-wrap items-center gap-3">
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setIndex(0);
            }}
            className="h-12 border-brutal border-line bg-paper px-3 font-body text-sm"
          >
            <option value="all">{tk('dash.scope.all')}</option>
            {data.cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.is_test ? ' · TEST' : ''}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            {tk('live.prev')}
          </Button>
          <span className="font-head text-sm font-bold">
            {index + 1} / {LIVE_SLIDES.length}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIndex((i) => Math.min(LIVE_SLIDES.length - 1, i + 1))}
          >
            {tk('live.next')}
          </Button>
          <Button size="sm" variant="solid" onClick={() => void toggleFullscreen()}>
            {isFull ? tk('live.exitFullscreen') : tk('live.enterFullscreen')}
          </Button>
          <span className="font-body text-xs opacity-60">{tk('live.hint')}</span>
        </CardBody>
      </Card>

      {/*
        投影面。全屏投的就是这一个元素 —— 上面那条控制条与 Admin 导航都在它外面。
        非全屏时给一个 16:9 的框,好在讲之前先看一眼版面。
      */}
      <div ref={slideRef} className="aspect-video w-full border-brutal border-line bg-paper">
        <LiveSlide
          slide={LIVE_SLIDES[index]}
          aggregate={data.aggregate}
          cohortName={data.selectedName}
          isTest={data.selectedIsTest}
        />
      </div>
    </div>
  );
}
