import { useCallback, useEffect, useState } from 'react';
import config from '@/config/assessment-config.json';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/brutalist';
import RadarPentagon, { buildRadarAxes } from '@/components/RadarPentagon';
import { useT } from '@/lib/i18n';
import { adminPost } from '@/lib/adminApi';

const DIMENSIONS = config.dimensions;
const TIERS = config.tiers;
const SCALE = config.meta.score_scale;
const Q_BY_ID = new Map(config.questions.map((q) => [q.id, q]));

export interface CohortAggregatePayload {
  n: number;
  averageTotal: number | null;
  dimensionMeans: Record<string, number>;
  tierCounts: Record<string, number>;
  weakestCounts: Record<string, number>;
  questions: { id: string; counts: number[]; answered: number; topShare: number | null; topIndex: number }[];
  enoughForShares: boolean;
  minN: number;
}

export interface DashboardPayload {
  scope: string;
  selectedIsTest: boolean;
  selectedName: string | null;
  cohorts: { id: string; name: string; is_test: boolean; event_date: string | null }[];
  aggregate: CohortAggregatePayload;
}

/**
 * 批次聚合看板。
 *
 * 【范围是显式参数,没有「默认全部」】`cohort_id` 必填,`'all'` 由服务端展开成
 * 「排除测试批次」而不是「不加过滤」—— 见 assessment-admin 的 cohortDashboard 注释
 * 与判断标准 15。前端**不做任何范围过滤**:那样会出现两份「什么算全部」的定义。
 *
 * 【比例不在响应里就渲不出来】样本不足时服务端把 topShare 置 null,
 * 所以这里没有「记得别显示百分比」这回事 —— 那个数字压根不存在。
 */
export default function CohortDashboard({ onAuthLost }: { onAuthLost: (forbidden: boolean) => void }) {
  const { tk, locale } = useT();
  const [scope, setScope] = useState('all');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const L = useCallback(<T,>(zh: T, en: T): T => (locale === 'en' ? en : zh), [locale]);

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

  const a = data.aggregate;
  const dimLabel = (key: string) => {
    const d = DIMENSIONS.find((x) => x.key === key);
    return d ? L(d.zh, d.en) : key;
  };
  const axes = buildRadarAxes(DIMENSIONS, a.dimensionMeans, {}, dimLabel);

  /** 计数条 —— 只画人数,宽度按本范围最大值归一。不显示百分比 */
  const Bar = ({ label, count, max }: { label: string; count: number; max: number }) => (
    <div className="flex items-center gap-2 font-body text-sm">
      <span className="w-40 shrink-0 truncate">{label}</span>
      <span className="h-4 bg-accent" style={{ width: `${max === 0 ? 0 : (count / max) * 100}%`, minWidth: count ? 2 : 0 }} />
      <span className="ml-auto font-head font-bold">{tk('dash.people').replace('{n}', String(count))}</span>
    </div>
  );

  const tierMax = Math.max(0, ...Object.values(a.tierCounts));
  const weakMax = Math.max(0, ...Object.values(a.weakestCounts));

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <CardBody className="flex flex-wrap items-center gap-3">
          <label className="font-body text-sm">{tk('dash.scope')}</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
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
          <span className="font-body text-sm opacity-70">
            {tk('dash.n').replace('{n}', String(a.n))}
          </span>
          {a.averageTotal !== null && (
            <span className="font-head font-bold">
              {tk('dash.avgTotal')} {a.averageTotal.toFixed(1)}
            </span>
          )}
        </CardBody>
      </Card>

      {/*
        选中测试批次时必须显著标出来 —— 否则会忘了自己在看假数据。
        与 Roster 那个「测试」徽章同一个理由,只是这里的后果更大:
        看板的数字会被投影给一屋子人。
      */}
      {data.selectedIsTest && (
        <Card tone="accent" padding="sm">
          <CardBody className="font-head text-sm font-bold uppercase">
            {tk('dash.testWarning')}
          </CardBody>
        </Card>
      )}

      {a.n === 0 ? (
        <Card padding="md">
          <CardBody className="font-body text-sm opacity-70">{tk('dash.empty')}</CardBody>
        </Card>
      ) : (
        <>
          {/*
            样本不足时**明说**,而不是静静少一块。
            报告页在同一个阈值下隐藏整个 cohort_rank 板块 —— 那是给学员看的;
            看板是给运营看的,少一块会被当成功能坏了。受众不同,选择不同。
          */}
          {!a.enoughForShares && (
            <Card padding="sm">
              <CardBody className="font-body text-sm">
                {tk('dash.lowSample').replace('{n}', String(a.n)).replace('{min}', String(a.minN))}
              </CardBody>
            </Card>
          )}

          <Card padding="md">
            <CardHeader>
              <CardTitle>{tk('dash.section.radar')}</CardTitle>
            </CardHeader>
            <CardBody>
              <RadarPentagon
                axes={axes}
                scale={SCALE}
                selfLabel={tk('dash.section.radar')}
                baselineLabel=""
                baselineN={1}
                noBaselineLabel=""
              />
            </CardBody>
          </Card>

          <Card padding="md">
            <CardHeader>
              <CardTitle>{tk('dash.section.tier')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-1">
              {TIERS.map((t) => (
                <Bar key={t.key} label={L(t.zh, t.en)} count={a.tierCounts[t.key] ?? 0} max={tierMax} />
              ))}
            </CardBody>
          </Card>

          <Card padding="md">
            <CardHeader>
              <CardTitle>{tk('dash.section.weakest')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-1">
              {DIMENSIONS.map((d) => (
                <Bar key={d.key} label={L(d.zh, d.en)} count={a.weakestCounts[d.key] ?? 0} max={weakMax} />
              ))}
            </CardBody>
          </Card>

          <Card padding="md">
            <CardHeader>
              <CardTitle>{tk('dash.section.questions')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="font-body text-xs opacity-60">{tk('dash.questionsHint')}</p>
              {a.questions.map((q) => {
                const spec = Q_BY_ID.get(q.id);
                const options = spec ? L(spec.zh.options, spec.en.options) : [];
                const max = Math.max(0, ...q.counts);
                return (
                  <div key={q.id} className="border-brutal border-line p-3">
                    <div className="mb-2 font-head text-sm font-bold">
                      {q.id} · {spec ? L(spec.zh.q, spec.en.q) : q.id}
                    </div>
                    <div className="space-y-1">
                      {q.counts.map((count, i) => (
                        <Bar key={i} label={options[i] ?? `#${i}`} count={count} max={max} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
