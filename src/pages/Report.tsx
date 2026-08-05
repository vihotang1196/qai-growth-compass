import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import config from '@/config/assessment-config.json';
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/components/brutalist';
import { SubmoduleMark, type MarkState } from '@/components/brutalist/SubmoduleMark';
import RadarPentagon, { type RadarAxis } from '@/components/RadarPentagon';
import { useT } from '@/lib/i18n';
import { QuizAuthError } from '@/lib/quizApi';
import { fetchReport, ReportNotReadyError, type ReportPayload } from '@/lib/reportApi';
import { badgeForScore } from '@/lib/scoring';
import { computeCosts, rootCauseLevel, selectActions, type ActionLibrary } from '@/lib/reportContent';

declare global {
  interface Window {
    /** Stage 9 的 PDF 渲染器等这个信号,确认报告(含雷达图)画完再截图 */
    __REPORT_READY__?: boolean;
  }
}

const DIMENSIONS = config.dimensions;
const DIM_BY_KEY = new Map(config.dimensions.map((d) => [d.key, d]));
const TIER_BY_KEY = new Map(config.tiers.map((t) => [t.key, t]));
const SCALE = config.meta.score_scale;
const DIM_REFS = config.dimensions.map((d) => ({ key: d.key, order: d.order }));
// action_library 含 _note(string),用 unknown 断到 ActionLibrary
const ACTION_LIB = config.action_library as unknown as ActionLibrary;

/** badgeForScore 的 'full'|'partial'|'missing' → SubmoduleMark 的 'full'|'half'|'empty' */
const MARK: Record<string, MarkState> = { full: 'full', partial: 'half', missing: 'empty' };

/**
 * 报告页 —— 九个板块。所有分数与判断在服务端定好(assessment-report),这里只渲染。
 *
 * 【徽章走 badgeForScore,不走 markStateFromScore】v3 计分归一化后,子模块徽章必须按
 * 归一化分判定:3 选项题的 index 2 是满分 5.0,旧的按 option_index 的逻辑会把它错标成 partial。
 * markStateFromScore 已标废弃,这里兑现。
 */
export default function Report() {
  const { tk, locale } = useT();
  const navigate = useNavigate();
  const [data, setData] = useState<ReportPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notReady' | 'error'>('loading');

  const onAuthLost = useCallback(() => navigate(`/expired?lang=${locale}`, { replace: true }), [navigate, locale]);
  /** 按当前语言取 config 字段(zh/en);config 是允许出现中文的源 */
  const L = useCallback(<T,>(zh: T, en: T): T => (locale === 'en' ? en : zh), [locale]);

  useEffect(() => {
    let alive = true;
    fetchReport()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setState('ready');
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof QuizAuthError) return onAuthLost();
        if (err instanceof ReportNotReadyError) return setState('notReady');
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, [onAuthLost]);

  // PDF 渲染器的信号:数据到、页面渲染后置 true(SVG 同步,mount 即画完)
  useEffect(() => {
    if (state === 'ready') window.__REPORT_READY__ = true;
    return () => {
      window.__REPORT_READY__ = false;
    };
  }, [state]);

  const costs = useMemo(() => {
    if (!data || data.leadsPerMonth === null || data.dealValue === null) return [];
    return computeCosts(data.result.dimensions, data.leadsPerMonth, data.dealValue, config.cost_model);
  }, [data]);
  const costByDim = useMemo(() => new Map(costs.map((c) => [c.dimension, c])), [costs]);

  const actions = useMemo(
    () => (data ? selectActions(data.result.dimensions, DIM_REFS, ACTION_LIB) : []),
    [data],
  );

  if (state === 'loading') return <Shell><p className="font-body">{tk('report.loading')}</p></Shell>;
  if (state === 'notReady') return <Shell><Notice>{tk('report.notReady')}</Notice></Shell>;
  if (state === 'error' || !data) return <Shell><Notice tone="accent">{tk('report.loadFailed')}</Notice></Shell>;

  const { result, submodules, baseline, cohort, survey } = data;
  const dimLabel = (key: string) => {
    const d = DIM_BY_KEY.get(key);
    return d ? L(d.zh, d.en) : key;
  };
  const fmtMoney = (n: number) => `RM ${Math.round(n).toLocaleString('en-US')}`;
  const level = (v: string) => tk(`report.level.${v}` as Parameters<typeof tk>[0]);
  // 徽章无障碍标签:从 config 的 submodule_badge_legend 取(已具备 / 部分具备 / 缺失)
  const badgeLabel = (badge: 'full' | 'partial' | 'missing') => {
    const char = (config.scoring.submodule_badge as Record<string, string>)[badge];
    const legend = (config.scoring.submodule_badge_legend as Record<string, Record<string, string>>)[locale] ?? {};
    return legend[char] ?? badge;
  };

  const radarAxes: RadarAxis[] = DIMENSIONS.map((d) => ({
    key: d.key,
    label: L(d.zh, d.en),
    color: d.color,
    value: result.dimensions[d.key] ?? 0,
    baseline: baseline.means[d.key] ?? 0,
  }));

  const tier = TIER_BY_KEY.get(result.tier);
  const priority = typeof survey.priority_dimension === 'string' ? survey.priority_dimension : null;
  const mismatch = priority !== null && priority !== result.weakest[0];

  return (
    <Shell>
      {/* 1. 总分 + 雷达 */}
      <Section title={tk('report.section.radar')}>
        <div className="mb-4 text-center">
          <div className="font-head text-6xl font-bold leading-none">{result.total.toFixed(1)}</div>
          <div className="mt-1 font-body text-sm opacity-60">{tk('report.total')} · 0–{SCALE.toFixed(1)}</div>
        </div>
        <RadarPentagon
          axes={radarAxes}
          scale={SCALE}
          selfLabel={tk('report.you')}
          baselineLabel={tk(baseline.source === 'cohort' ? 'report.baseline.cohort' : 'report.baseline.global')}
        />
      </Section>

      {/* 2. 分档 */}
      {tier && (
        <Section title={tk('report.section.tier')}>
          <p className="font-head text-2xl font-bold">{L(tier.zh, tier.en)}</p>
          <p className="mt-2 font-body leading-relaxed">{L(tier.zh_desc, tier.en_desc)}</p>
        </Section>
      )}

      {/* 3. 批次位置 —— 样本 < 10 时 cohort 为 null,整块不渲染 */}
      {cohort && (
        <Section title={tk('report.section.cohort')}>
          <p className="font-head text-xl font-bold">{tk(`report.cohort.band.${cohort.standing.band}` as Parameters<typeof tk>[0])}</p>
          <p className="mt-1 font-body text-sm opacity-70">
            {tk('report.cohort.sameTier').replace('{n}', String(cohort.standing.sameTierOthers))}
          </p>
          <p className="mt-4 font-body text-sm opacity-70">{tk('report.cohort.diffHint')}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
            {DIMENSIONS.map((d) => {
              const diff = cohort.diffs[d.key] ?? 0;
              return (
                <div key={d.key} className="border-brutal border-line p-2 text-center font-body">
                  <div className="text-xs opacity-60">{L(d.zh, d.en)}</div>
                  <div className="font-head font-bold">{diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* 4. 强项 */}
      <Section title={tk('report.section.strengths')}>
        <div className="flex flex-wrap gap-3">
          {result.strongest.map((key) => (
            <div key={key} className="border-brutal border-line bg-paper px-4 py-2 font-body">
              <span className="font-head font-bold">{dimLabel(key)}</span>
              <span className="ml-2 opacity-70">{(result.dimensions[key] ?? 0).toFixed(1)}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* 5. 短板主诊断:现状 / 代价 / 根因 */}
      <Section title={tk('report.section.weaknesses')}>
        <div className="space-y-4">
          {result.weakest.map((key) => {
            const score = result.dimensions[key] ?? 0;
            const cost = costByDim.get(key);
            const rc = ACTION_LIB[key]?.root_cause;
            const rcText = rc ? rc[rootCauseLevel(score)] : '';
            return (
              <Card key={key} shadow="base" padding="md">
                <CardBody className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-head text-lg font-bold">{dimLabel(key)}</h3>
                    <span className="font-head font-bold opacity-70">{score.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="font-head text-xs font-bold uppercase opacity-50">{tk('report.weakness.rootCause')}</span>
                    <p className="mt-1 font-body leading-relaxed">{rcText}</p>
                  </div>
                  {cost && (
                    <div className="border-brutal border-line bg-muted p-3">
                      <span className="font-head text-xs font-bold uppercase opacity-50">{tk('report.weakness.cost')}</span>
                      <p className="mt-1 font-body">
                        <span className="font-head text-xl font-bold">{fmtMoney(cost.amount)}</span>
                        <span className="opacity-60"> {tk('report.cost.perMonth')}</span>
                        <span className="ml-2 font-body text-sm">{L(cost.zh_label, cost.en_label)}</span>
                      </p>
                      {/* 每条假设 + 总 disclaimer,一个确定数字会毁掉信任 */}
                      <p className="mt-1 font-body text-xs opacity-60">{cost.zh_note}</p>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
          {costs.length > 0 && (
            <p className="font-body text-xs opacity-50">{L(config.cost_model.disclaimer_zh, config.cost_model.disclaimer_en)}</p>
          )}
        </div>
      </Section>

      {/* 6. 15 项子模块明细 */}
      <Section title={tk('report.section.submodules')}>
        <div className="space-y-3">
          {DIMENSIONS.map((d) => (
            <div key={d.key}>
              <div className="mb-1 flex items-center gap-2 font-head text-sm font-bold">
                <span className="h-3 w-3 border-brutal border-line" style={{ backgroundColor: d.color }} aria-hidden />
                {L(d.zh, d.en)}
              </div>
              <div className="grid gap-1 md:grid-cols-3">
                {L(d.submodules_zh, d.submodules_en).map((label, i) => {
                  const s = submodules[d.key]?.[i];
                  const badge = s === null || s === undefined ? 'missing' : badgeForScore(s, SCALE);
                  return (
                    <div key={i} className="flex items-center gap-2 border-brutal border-line p-2 font-body text-sm">
                      <SubmoduleMark state={MARK[badge]} label={badgeLabel(badge)} />
                      <span className="truncate">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* 7. 30 天行动清单 */}
      <Section title={tk('report.section.actions')}>
        <ol className="space-y-3">
          {actions.map((a, i) => (
            <li key={a.id} className="flex gap-3 border-brutal border-line p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-ink font-head font-bold text-paper">{i + 1}</span>
              <div className="space-y-1 font-body">
                <p className="leading-snug">{L(a.zh, a.en)}</p>
                <div className="flex gap-3 text-xs opacity-60">
                  <span>{tk('report.action.difficulty')}: {level(a.difficulty)}</span>
                  <span>{tk('report.action.impact')}: {level(a.impact)}</span>
                  <span>{dimLabel(a.dimension)}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* 8. 下一步(offer) + mismatch 高亮 */}
      <NextStep weakest={result.weakest[0]} locale={locale} L={L} mismatch={mismatch}
        priorityLabel={priority ? dimLabel(priority) : ''} needLabel={dimLabel(result.weakest[0])} tk={tk} />

      {/* 9. PDF / 打印 */}
      <Section title={tk('report.section.share')}>
        <p className="font-body text-sm opacity-70">{tk('report.pdf.pending')}</p>
        {/* 打印保底(print.css)—— Stage 9 接自动 PDF,这里先给浏览器打印 */}
        <Button className="mt-3 no-print" variant="outline" onClick={() => window.print()}>
          {tk('report.pdf.print')}
        </Button>
      </Section>
    </Shell>
  );
}

function NextStep({
  weakest,
  L,
  mismatch,
  priorityLabel,
  needLabel,
  tk,
}: {
  weakest: string;
  locale: string;
  L: <T>(zh: T, en: T) => T;
  mismatch: boolean;
  priorityLabel: string;
  needLabel: string;
  tk: ReturnType<typeof useT>['tk'];
}) {
  const route = (config.offer_routing as unknown as Record<string, { product: string; zh_cta: string }>)[weakest];
  const product = route ? config.offer_routing.products[route.product as keyof typeof config.offer_routing.products] : null;
  return (
    <Section title={tk('report.section.nextStep')}>
      {mismatch && (
        <p className="mb-3 border-brutal border-line bg-accent p-3 font-body text-sm">
          {tk('report.mismatch').replace('{want}', priorityLabel).replace('{need}', needLabel)}
        </p>
      )}
      {route && product && (
        <Card tone="ink" padding="md">
          <CardBody className="space-y-2">
            <p className="font-head text-lg font-bold">{L(product.zh, product.en)}</p>
            <p className="font-body leading-relaxed">{route.zh_cta}</p>
          </CardBody>
        </Card>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-section">
      <Card shadow="base" padding="md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardBody>{children}</CardBody>
      </Card>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-muted p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-6">{children}</div>
    </main>
  );
}

function Notice({ children, tone = 'paper' }: { children: React.ReactNode; tone?: 'paper' | 'accent' }) {
  return (
    <Card tone={tone} padding="md">
      <CardBody className="font-body">{children}</CardBody>
    </Card>
  );
}
