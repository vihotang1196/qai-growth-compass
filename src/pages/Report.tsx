import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import config from '@/config/assessment-config.json';
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/components/brutalist';
import { SubmoduleMark, type MarkState } from '@/components/brutalist/SubmoduleMark';
import RadarPentagon, { buildRadarAxes } from '@/components/RadarPentagon';
import PentagonLoader from '@/components/PentagonLoader';
import { useT } from '@/lib/i18n';
import { QuizAuthError } from '@/lib/quizApi';
import { fetchReport, ReportNotReadyError, type ReportPayload } from '@/lib/reportApi';
import { badgeForScore } from '@/lib/scoring';
import { computeCosts, rootCauseLevel, roundToSignificant, selectActions, type ActionLibrary } from '@/lib/reportContent';
import { actionEvidence, evidencePair, type QuestionLike } from '@/lib/reportEvidence';

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
const QUESTIONS = config.questions as unknown as QuestionLike[];
const Q_BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

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

  if (state === 'loading')
    return (
      <Shell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <PentagonLoader label={tk('report.loading')} />
        </div>
      </Shell>
    );
  if (state === 'notReady') return <Shell><Notice>{tk('report.notReady')}</Notice></Shell>;
  if (state === 'error' || !data) return <Shell><Notice tone="accent">{tk('report.loadFailed')}</Notice></Shell>;

  const { result, submodules, evidence, answersByQuestion, baseline, cohort, survey } = data;
  const dimLabel = (key: string) => {
    const d = DIM_BY_KEY.get(key);
    return d ? L(d.zh, d.en) : key;
  };
  // 取整到 2 位有效数字 —— 精确到个位是一个我们给不出的承诺(见 reportContent.roundToSignificant)
  const fmtMoney = (n: number) => `RM ${roundToSignificant(n).toLocaleString('en-US')}`;
  const level = (v: string) => tk(`report.level.${v}` as Parameters<typeof tk>[0]);
  // 徽章无障碍标签:从 config 的 submodule_badge_legend 取(已具备 / 部分具备 / 缺失)
  const badgeLabel = (badge: 'full' | 'partial' | 'missing') => {
    const char = (config.scoring.submodule_badge as Record<string, string>)[badge];
    const legend = (config.scoring.submodule_badge_legend as Record<string, Record<string, string>>)[locale] ?? {};
    return legend[char] ?? badge;
  };

  // 轴构造只有一份实现(RadarPentagon.buildRadarAxes),测试调的是同一个函数
  const radarAxes = buildRadarAxes(DIMENSIONS, result.dimensions, baseline.means, dimLabel);

  const weakSet = new Set(result.weakest);
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
          baselineLabel={`${tk(baseline.source === 'cohort' ? 'report.baseline.cohort' : 'report.baseline.global')} · ${tk('report.baseline.n').replace('{n}', String(baseline.n))}`}
        />
      </Section>

      {/* 1.5 每一维为什么是这个分 —— 依据是客户自己选的那三个选项,不是我们判的 */}
      <Section title={tk('report.section.evidence')}>
        <div className="space-y-4">
          {DIMENSIONS.map((d) => {
            const subLabels = L(d.submodules_zh, d.submodules_en);
            return (
              <div key={d.key}>
                <div className="mb-1 flex items-center gap-2 font-head text-sm font-bold">
                  <span className="h-3 w-3 border-brutal border-line" style={{ backgroundColor: d.color }} aria-hidden />
                  {L(d.zh, d.en)}
                  <span className="ml-auto">{(result.dimensions[d.key] ?? 0).toFixed(1)}</span>
                </div>
                <div className="space-y-1">
                  {subLabels.map((label, i) => {
                    const sc = submodules[d.key]?.[i];
                    const badge = sc === null || sc === undefined ? 'missing' : badgeForScore(sc, SCALE);
                    const ev = evidence[d.key]?.[i];
                    const pair = evidencePair(ev ? Q_BY_ID.get(ev.questionId) : undefined, ev?.optionIndex, locale);
                    return (
                      <div key={i} className="border-brutal border-line p-2 font-body text-sm">
                        <div className="flex items-center gap-2">
                          <SubmoduleMark state={MARK[badge]} label={badgeLabel(badge)} />
                          <span className="font-bold">{label}</span>
                        </div>
                        {pair ? (
                          <div className="mt-1 pl-6">
                            <div>
                              <span className="opacity-50">{tk('report.evidence.now')}:</span> {pair.current}
                            </div>
                            {/* 已顶格就不摆「目标」,那会像在说他还没做到 */}
                            {!pair.atTarget && (
                              <div className="mt-0.5">
                                <span className="opacity-50">{tk('report.evidence.target')}:</span>{' '}
                                <span className="bg-accent px-1">{pair.target}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-1 pl-6 opacity-50">{tk('report.evidence.unanswered')}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
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
                        <span className="opacity-60">{tk('report.cost.approx')} </span>
                        <span className="font-head text-xl font-bold">{fmtMoney(cost.amount)}</span>
                        <span className="opacity-60"> {tk('report.cost.perMonth')}</span>
                        <span className="ml-2 font-body text-sm">{L(cost.zh_label, cost.en_label)}</span>
                      </p>
                      {/**
                        * 【假设与数字同级,不做浅灰小字】一个大号加粗的金额配一行浅灰小字,
                        * 视觉上像确定的事实,而它建立在两层假设上。客户拿去对真实账目一次对不上,
                        * 整份报告的信任就没了 —— 而报告其余部分的说服力全靠「数据是他自己填的」。
                        */}
                      <p className="mt-2 border-t-2 border-line pt-2 font-body text-sm">
                        <span className="font-bold">{tk('report.cost.assumption')}:</span> {cost.zh_note}
                      </p>
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
                  /**
                   * 缺失项红框(alert token,语义唯一:红 = 缺失/优先)。
                   * 但只有【最弱两维】的缺失额外标「优先」—— 分数低的人否则会看到一整片红,
                   * 报告读起来像判决书。标了优先的那几格,正好对应第 7 板块的动作,两块因此连起来。
                   */
                  const isMissing = badge === 'missing';
                  const isPriority = isMissing && weakSet.has(d.key);
                  return (
                    <div
                      key={i}
                      className={[
                        'flex items-center gap-2 border-brutal p-2 font-body text-sm',
                        isMissing ? 'qai-alert-border' : 'border-line',
                      ].join(' ')}
                    >
                      <SubmoduleMark state={MARK[badge]} label={badgeLabel(badge)} />
                      <span className="truncate">{label}</span>
                      {isPriority && (
                        <span className="ml-auto shrink-0 qai-alert-fill px-1.5 py-0.5 font-head text-xs font-bold">
                          {tk('report.badge.priority')}
                        </span>
                      )}
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
          {actions.map((a, i) => {
            // 前后对比复用「你自己的作答」:related_question 为 null 就不显示这一行,
            // 不为了统一而编一个对比
            const pair = actionEvidence(
              (a as { related_question?: string | null }).related_question,
              QUESTIONS,
              answersByQuestion,
              locale,
            );
            return (
              <li key={a.id} className="flex gap-3 border-brutal border-line p-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-ink font-head font-bold text-paper">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-2 font-body">
                  <p className="leading-snug">{L(a.zh, a.en)}</p>
                  {pair && !pair.atTarget && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="border-brutal border-line bg-paper px-2 py-1">
                        <span className="opacity-50">{tk('report.evidence.now')}: </span>{pair.current}
                      </span>
                      <span aria-hidden className="font-head font-bold">→</span>
                      <span className="border-brutal border-line bg-accent px-2 py-1">
                        <span className="opacity-60">{tk('report.evidence.target')}: </span>{pair.target}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <LevelTag kind="difficulty" value={a.difficulty} label={`${tk('report.difficulty')} ${level(a.difficulty)}`} />
                    <LevelTag kind="impact" value={a.impact} label={`${tk('report.impact')} ${level(a.impact)}`} />
                    <span className="opacity-60">{dimLabel(a.dimension)}</span>
                  </div>
                </div>
              </li>
            );
          })}
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

/**
 * 难度 / 影响的 tag。
 * 【为什么不用红色表示「难度高」】红色已经专属「缺失 / 优先」。同一份报告里红色一会儿是
 * 「你缺这个」一会儿是「这件事难」,读者要在两套语义间切换。改用两个不同的视觉维度:
 *   难度 = 墨色深浅(阻力)  低 白底 / 中 浅灰 / 高 墨底白字
 *   影响 = 黄色深浅(收益)  低 白底 / 中 浅黄 / 高 满黄
 * 于是「高影响低难度」= 满黄 + 白底,一眼就是该先做的那条 —— 颜色本身在排序。
 */
function LevelTag({ kind, value, label }: { kind: 'difficulty' | 'impact'; value: string; label: string }) {
  const difficulty: Record<string, string> = {
    low: 'bg-paper text-ink',
    medium: 'bg-muted text-ink',
    high: 'bg-ink text-paper',
  };
  const impact: Record<string, string> = {
    low: 'bg-paper text-ink',
    medium: 'bg-accent/40 text-ink',
    high: 'bg-accent text-accent-fg',
  };
  const tone = (kind === 'difficulty' ? difficulty : impact)[value] ?? 'bg-paper text-ink';
  return <span className={`border-brutal border-line px-2 py-0.5 font-head font-bold ${tone}`}>{label}</span>;
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
