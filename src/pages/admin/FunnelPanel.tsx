import { useCallback, useEffect, useState } from 'react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { adminPost } from '@/lib/adminApi';
import type { UiKey } from '@/config/ui-strings';

const STAGES = ['link_sent', 'logged_in', 'started_answering', 'survey', 'completed'] as const;

export interface FunnelPayload {
  scope: string;
  selectedIsTest: boolean;
  selectedName: string | null;
  cohorts: { id: string; name: string; is_test: boolean }[];
  funnel: {
    base: number;
    stages: { key: string; reached: number; droppedFromPrev: number }[];
    inconsistent: number;
  };
}

/**
 * 漏斗监控。
 *
 * 【已付款是基数,渲在标题上,不占一格分段】画成分段的话它永远 100% ——
 * 一个永远满格的分段不携带信息,只占掉一格注意力。
 *
 * 【每一段都给「掉了几人」】漏斗的用途是找**掉在哪**,而不是看还剩多少。
 * 所以流失数与到达数并排给,不用百分比 —— 与看板同一条:
 * 比例是关于总体的断言,而这里的样本同样可能只有个位数。
 */
export default function FunnelPanel({ onAuthLost }: { onAuthLost: (forbidden: boolean) => void }) {
  const { tk } = useT();
  const [scope, setScope] = useState('all');
  const [data, setData] = useState<FunnelPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (target: string) => {
      setNotice(null);
      try {
        setData(await adminPost<FunnelPayload>('funnel', { cohort_id: target }));
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

  const f = data.funnel;

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
          {/* 已付款 = 基数,在标题上,不占分段 */}
          <span className="font-head font-bold">
            {tk('funnel.base').replace('{n}', String(f.base))}
          </span>
        </CardBody>
      </Card>

      {data.selectedIsTest && (
        <Card tone="accent" padding="sm">
          <CardBody className="font-head text-sm font-bold uppercase">
            {tk('dash.testWarning')}
          </CardBody>
        </Card>
      )}

      {/*
        矛盾数据被级联抹平了,但必须报出来 —— 抹平等于隐藏。
        它不为 0 说明【别处】有 bug,而不是这块统计有 bug。
      */}
      {f.inconsistent > 0 && (
        <Card padding="sm">
          <CardBody className="font-body text-sm">
            {tk('funnel.inconsistent').replace('{n}', String(f.inconsistent))}
          </CardBody>
        </Card>
      )}

      {f.base === 0 ? (
        <Card padding="md">
          <CardBody className="font-body text-sm opacity-70">{tk('funnel.empty')}</CardBody>
        </Card>
      ) : (
        <Card padding="md">
          <CardHeader>
            <CardTitle>{tk('admin.tab.funnel')}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {STAGES.map((key) => {
              const stage = f.stages.find((s) => s.key === key);
              const reached = stage?.reached ?? 0;
              const dropped = stage?.droppedFromPrev ?? 0;
              return (
                <div key={key} className="flex items-center gap-2 font-body text-sm">
                  <span className="w-28 shrink-0 whitespace-normal leading-snug">
                    {tk(`funnel.stage.${key}` as UiKey)}
                  </span>
                  <span
                    className="h-4 bg-accent"
                    style={{
                      width: `${f.base === 0 ? 0 : (reached / f.base) * 100}%`,
                      minWidth: reached ? 3 : 0,
                    }}
                  />
                  <span className="w-14 shrink-0 whitespace-nowrap text-right font-head font-bold">
                    {tk('dash.people').replace('{n}', String(reached))}
                  </span>
                  {/* 流失数是这块的用途所在 —— 漏斗要看的是掉在哪,不是还剩多少 */}
                  <span className="w-20 shrink-0 whitespace-nowrap text-right font-body text-xs opacity-60">
                    {dropped > 0 ? tk('funnel.dropped').replace('{n}', String(dropped)) : ''}
                  </span>
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
