import { useCallback, useEffect, useMemo, useState } from 'react';
import config from '@/config/assessment-config.json';
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { adminPost } from '@/lib/adminApi';
import type { UiKey } from '@/config/ui-strings';

const DIM_BY_KEY = new Map(config.dimensions.map((d) => [d.key, d]));

interface InsightRow {
  entitlementId: string;
  name: string | null;
  cohortName: string | null;
  isTest: boolean;
  goal90d: string | null;
  biggestBlocker: string | null;
  consultInterest: string | null;
  priorityDimension: string | null;
  weakestPrimary: string | null;
  alignment: 'aligned' | 'second_weakest' | 'mismatched' | null;
  highIntent: boolean;
}

interface InsightsPayload {
  scope: string;
  selectedIsTest: boolean;
  cohorts: { id: string; name: string; is_test: boolean }[];
  rows: InsightRow[];
  counts: { total: number; highIntent: number; aligned: number; secondWeakest: number; mismatched: number };
}

/**
 * 问卷洞察。三块:高意向名单、想修的 ≠ 该修的、开放题原文(可搜)。
 *
 * 【「为什么这批人排在前面」写在板块里,不写在 tooltip 或文档里】
 * 半年后回来看这个页面时,它要**当场**说清那个理由 —— 一个只有筛选结果、
 * 没有理由的名单,过一阵就会被当成「不知道怎么来的一批人」而不再被信。
 *
 * 【搜索是前端做的】与 roster 同一个判断:当前批次规模几十到一两百人,
 * 一次全取再前端筛够用。**批次上到几千人时要把搜索推回 SQL。**
 */
export default function SurveyInsights({ onAuthLost }: { onAuthLost: (forbidden: boolean) => void }) {
  const { tk, locale } = useT();
  const [scope, setScope] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState<InsightsPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const L = useCallback(<T,>(zh: T, en: T): T => (locale === 'en' ? en : zh), [locale]);

  const load = useCallback(
    async (target: string) => {
      setNotice(null);
      try {
        setData(await adminPost<InsightsPayload>('survey_insights', { cohort_id: target }));
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

  async function exportHighIntent() {
    try {
      const res = await adminPost<{ filename: string; csv: string }>('high_intent_export', {
        cohort_id: scope,
      });
      const url = URL.createObjectURL(new Blob([res.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  const dimLabel = useCallback(
    (key: string | null) => {
      if (!key) return '—';
      const d = DIM_BY_KEY.get(key);
      return d ? L(d.zh, d.en) : key;
    },
    [L],
  );

  const matched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return data?.rows ?? [];
    return (data?.rows ?? []).filter((r) =>
      `${r.goal90d ?? ''} ${r.biggestBlocker ?? ''} ${r.name ?? ''}`.toLowerCase().includes(needle),
    );
  }, [data, q]);

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

  const highIntent = data.rows.filter((r) => r.highIntent);
  const offTarget = data.rows.filter((r) => r.alignment === 'mismatched');
  const nearTarget = data.rows.filter((r) => r.alignment === 'second_weakest');

  const Person = ({ r, showWhy }: { r: InsightRow; showWhy?: boolean }) => (
    <div className="border-brutal border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 font-head text-sm font-bold">
        {r.name ?? '—'}
        {r.isTest && <Badge tone="accent">{tk('admin.testBadge')}</Badge>}
        {r.cohortName && <span className="font-body text-xs opacity-60">{r.cohortName}</span>}
        {showWhy && r.alignment && (
          <Badge tone="muted">{tk(`ins.align.${r.alignment}` as UiKey)}</Badge>
        )}
      </div>
      {showWhy && (
        <div className="mt-1 font-body text-xs">
          {tk('ins.wants')} <b>{dimLabel(r.priorityDimension)}</b> · {tk('ins.needs')}{' '}
          <b>{dimLabel(r.weakestPrimary)}</b>
        </div>
      )}
      {r.goal90d && (
        <div className="mt-1 whitespace-pre-wrap break-words font-body text-xs leading-snug">
          <span className="opacity-60">{tk('ins.goal')}:</span> {r.goal90d}
        </div>
      )}
      {r.biggestBlocker && (
        <div className="mt-1 whitespace-pre-wrap break-words font-body text-xs leading-snug">
          <span className="opacity-60">{tk('ins.blocker')}:</span> {r.biggestBlocker}
        </div>
      )}
    </div>
  );

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
            {tk('ins.count').replace('{n}', String(data.counts.total))}
          </span>
          <span className="font-head font-bold">
            {tk('ins.highIntentCount').replace('{n}', String(data.counts.highIntent))}
          </span>
        </CardBody>
      </Card>

      {data.selectedIsTest && (
        <Card tone="accent" padding="sm">
          <CardBody className="font-head text-sm font-bold uppercase">{tk('dash.testWarning')}</CardBody>
        </Card>
      )}

      {data.counts.total === 0 ? (
        <Card padding="md">
          <CardBody className="font-body text-sm opacity-70">{tk('ins.empty')}</CardBody>
        </Card>
      ) : (
        <>
          <Card padding="md">
            <CardHeader>
              <CardTitle>{tk('ins.section.highIntent')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {/* 导出在服务端无条件剔测试行,不看这个页面的任何状态 */}
              <Button size="sm" variant="solid" onClick={() => void exportHighIntent()}>
                {tk('ins.exportHighIntent')}
              </Button>
              {highIntent.map((r) => (
                <Person key={r.entitlementId} r={r} />
              ))}
            </CardBody>
          </Card>

          <Card padding="md">
            <CardHeader>
              <CardTitle>{tk('ins.section.mismatch')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {/*
                【理由写在板块里,不在 tooltip】半年后回来看这个页面时,
                它要当场说清为什么这批人排在前面 —— 一个只有筛选结果、没有理由的名单,
                过一阵就会被当成「不知道怎么来的一批人」而不再被信。
              */}
              <p className="whitespace-pre-wrap break-words border-brutal border-line bg-muted p-3 font-body text-xs leading-snug">
                {tk('ins.mismatchWhy')}
              </p>
              {offTarget.map((r) => (
                <Person key={r.entitlementId} r={r} showWhy />
              ))}
              {nearTarget.map((r) => (
                <Person key={r.entitlementId} r={r} showWhy />
              ))}
            </CardBody>
          </Card>

          <Card padding="md">
            <CardHeader>
              <CardTitle>{tk('ins.section.answers')}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <div className="w-72">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tk('ins.search')} />
              </div>
              {matched.length === 0 ? (
                <p className="font-body text-sm opacity-70">{tk('ins.noMatch')}</p>
              ) : (
                matched.map((r) => <Person key={r.entitlementId} r={r} />)
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
