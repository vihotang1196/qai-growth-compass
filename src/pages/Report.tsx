import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import config from '@/config/assessment-config.json';
import { Button, Card, CardBody } from '@/components/brutalist';
import { SubmoduleMark, type MarkState } from '@/components/brutalist/SubmoduleMark';
import RadarPentagon, { buildRadarAxes } from '@/components/RadarPentagon';
import PentagonLoader from '@/components/PentagonLoader';
import { useT } from '@/lib/i18n';
import Section from './ReportSection';
import ReportTakeaway from './ReportTakeaway';
import { cardsFor } from '../../api/_lib/reportFiles';
import { QuizAuthError, quizApi } from '@/lib/quizApi';
import { fetchPdfState, fetchReport, ReportNotReadyError, type ReportPayload, requestReportFile} from '@/lib/reportApi';
import { openFreshPdf } from '@/lib/openPdf';
import { badgeForScore } from '@/lib/scoring';
import { isPriorityMismatch } from '../../api/_lib/surveySignals';
import { computeCosts, rootCauseLevel, roundToSignificant, selectActions, type ActionLibrary } from '@/lib/reportContent';
import { actionEvidence, evidencePair, type QuestionLike } from '@/lib/reportEvidence';
import { useDelayedFlag, useSingleFlight } from '@/lib/useBusy';
import { useTransitionNavigate } from '@/lib/usePageMotion';
import { createSingleFlight } from '@/lib/singleFlight';
import { useConfirm } from '@/components/ConfirmProvider';
import { historyItems, historyNote, openRetakeBanner, parseAttemptParam, retakeAction } from '@/lib/retakeView';
import {
  abandonConfirmOptions,
  abandonRetakeFlow,
  continueRetakeFlow,
  retakeConfirmOptions,
  startRetakeFlow,
} from '@/lib/retakeFlow';
import { ReportHistory, ReportHistoryNote, ReportRetakeBanner, ReportRetakeSection } from './ReportRetake';

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
 * PDF 渲染器打开报告页时带 `?rt=`(渲染令牌)。那时**一点动效都不要**:块的依次淡入
 * 会让 __REPORT_READY__ 之后的那一刻有几块还停在半透明 —— PDF 截到的就是那一帧。
 * (motion.css 的 @media print 是第二道;这一道不依赖渲染器用不用打印媒体。)
 * 每次渲染时读,不在模块加载时读一次 —— 后者在页内跳转过来时是旧值。
 */
function isRenderMode(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('rt');
}

/**
 * 报告页 —— 九个板块。原「15 项子模块明细表」已并入「每维为什么是这个分」:
 * 后者本就逐项列出同样 15 个子模块,且多了「你选的是什么 / 目标是什么」,信息量严格更大。
 * 同一组数据在一份报告里出现两次,读者会以为第二次有新信息,读完发现没有 —— 那是在消耗
 * 他的注意力预算,而后面的代价换算与 30 天清单才是要他认真读的。所有分数与判断在服务端定好(assessment-report),这里只渲染。
 *
 * 【徽章走 badgeForScore,不走 markStateFromScore】v3 计分归一化后,子模块徽章必须按
 * 归一化分判定:3 选项题的 index 2 是满分 5.0,旧的按 option_index 的逻辑会把它错标成 partial。
 * markStateFromScore 已标废弃,这里兑现。
 */
export default function Report() {
  /**
   * 【`?attempt=n` 换了就整个重挂】从历次结果点进另一份(或回到最新那份)是同一个路由、只换查询参数 ——
   * React Router 不会重挂组件,而这一页的状态(数据、PDF 轮询、正在打开哪一份)全都属于「那一份」。
   * 用 key 让它重来一遍,比逐个状态去清更不会漏(漏一个的话,会在第 1 份的页面上轮询第 2 份的 PDF)。
   * PDF 渲染器(`?rt=`)从不带 attempt —— 它按渲染令牌里的 session 取。
   */
  const [params] = useSearchParams();
  const attempt = isRenderMode() ? null : parseAttemptParam(params.get('attempt'));
  return <ReportView key={attempt ?? 'latest'} attempt={attempt} />;
}

function ReportView({ attempt }: { attempt: number | null }) {
  const { tk, locale } = useT();
  const navigate = useTransitionNavigate();
  const ask = useConfirm();
  const [data, setData] = useState<ReportPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notReady' | 'error'>('loading');
  /** PDF 状态与新签 URL —— 由轮询更新;pollDone 表示已放弃轮询(见下) */
  const [pdf, setPdf] = useState<{ status: string; url: string | null }>({ status: 'pending', url: null });
  const [pollDone, setPollDone] = useState(false);
  /** 正在打开哪种语言那一份 —— 只有那一个按钮转圈。null = 没有 */
  const [opening, setOpening] = useState<'zh' | 'en' | null>(null);
  /** 正在为哪种语言触发生成 —— 按钮据此禁用并改文案。null = 没有在触发 */
  const [generating, setGenerating] = useState<'zh' | 'en' | null>(null);
  /** 下载与生成各自一道闸:等待期间再按无效(同步挡,见 lib/singleFlight.ts) */
  const openFlight = useSingleFlight();
  const generateFlight = useSingleFlight();
  /** 报告加载等满 150ms 才出现五边形动画 —— 快的时候直接是报告 */
  const showLoader = useDelayedFlag(state === 'loading');

  /**
   * ── 重填(第 3 步)──
   * `retakeBusy`:哪一个重填动作的请求在路上(按钮据此压下去 / 转圈)—— 只包住请求,不包确认框开着的那段(见 lib/retakeFlow.ts)。
   * `retakeGuard`:整个动作(确认框 + 请求)一道同步的闸 —— 连点两下不会弹出两个确认框。
   * `revokedNow`:页面开着的时候链接被作废了(点下去拿到 403)。payload 不会自己变,所以记在这里,按钮的位置据此说「已作废」。
   */
  const [retakeBusy, setRetakeBusy] = useState<'start' | 'continue' | 'abandon' | null>(null);
  const [retakeFailed, setRetakeFailed] = useState<'start' | 'continue' | 'abandon' | null>(null);
  const [revokedNow, setRevokedNow] = useState(false);
  const retakeGuard = useRef(createSingleFlight()).current;
  /** 「还要等多久」按页面拿到数据的那一刻算 */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const onAuthLost = useCallback(() => navigate(`/expired?lang=${locale}`, { replace: true }), [navigate, locale]);
  /** 按当前语言取 config 字段(zh/en);config 是允许出现中文的源 */
  const L = useCallback(<T,>(zh: T, en: T): T => (locale === 'en' ? en : zh), [locale]);

  useEffect(() => {
    let alive = true;
    fetchReport(attempt)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setPdf({ status: d.pdfStatus, url: d.pdfUrl });
        setNowMs(Date.now());
        // 以前的一份不轮询:它的文件只会是当时生成好的那些,没有「正在生成」可等
        if (d.attempt && !d.attempt.isLatest) setPollDone(true);
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
  }, [onAuthLost, attempt]);

  // PDF 渲染器的信号:数据到、页面渲染后置 true(SVG 同步,mount 即画完)
  useEffect(() => {
    if (state === 'ready') window.__REPORT_READY__ = true;
    return () => {
      window.__REPORT_READY__ = false;
    };
  }, [state]);

  /**
   * 轮询 pdf_status —— **有上限**。
   *
   * 渲染约 16 秒,但失败时可能一直停在 pending。所以轮到上限就停下来,让第 9 板块回到
   * 那句静态文案(「稍后回到这个链接」)—— 那句本来就是兜底,轮询只是让它在成功时
   * 自动变成按钮。无限转圈会让客户以为页面坏了,而实际是渲染失败了。
   *
   * 3 秒一次 × 20 次 = 60 秒:比渲染耗时(16s)留了三倍余量,又不至于让人干等太久。
   */
  useEffect(() => {
    if (state !== 'ready' || pollDone) return;
    if (pdf.status === 'ready' || pdf.status === 'failed_permanent') return;

    let attempts = 0;
    let alive = true;
    const timer = setInterval(() => {
      if (!alive) return;
      attempts += 1;
      if (attempts > 20) {
        setPollDone(true);
        clearInterval(timer);
        return;
      }
      void fetchPdfState(attempt)
        .then((st) => {
          if (!alive) return;
          setPdf({ status: st.pdfStatus, url: st.pdfUrl });
          if (st.pdfStatus === 'ready' || st.pdfStatus === 'failed_permanent') clearInterval(timer);
        })
        .catch(() => {
          // 轮询失败不打扰客户 —— 报告本身已经在看了,PDF 只是增量
        });
    }, 3000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [state, pdf.status, pollDone, attempt]);

  /**
   * 【点击那一刻才取 URL,不用页面加载时那条】signed URL 有效期 1 小时。
   * 页面开着超过一小时再点,存下来的那条会拿到 Storage 的 403 —— 那对客户无法解释。
   * 每次点击现取一条新的,「URL 会过期」这件事就不存在,而不是变成一个要处理的错误。
   */
  /**
   * 打开某种语言那一份。
   *
   * 【点击那一刻重新取一次,而不是用页面加载时那条 URL】signed URL 只活 1 小时,
   * 而报告页一开就是几十分钟。重新取把「URL 会过期」从错误处理变成不存在的问题。
   */
  async function openPdfIn(lang: 'zh' | 'en') {
    setOpening(lang);
    try {
      const fresh = await fetchReport(attempt);
      setData(fresh);
      setPdf({ status: fresh.pdfStatus, url: fresh.pdfUrl });
      // 当前页跳转,不开新窗口 —— 开新窗口在 await 之后会被手机浏览器当成弹窗拦掉(见 lib/openPdf.ts)
      openFreshPdf(fresh, lang, {
        assign: (url) => window.location.assign(url),
        open: (url, target, features) => window.open(url, target, features),
      });
    } finally {
      setOpening(null);
    }
  }

  /**
   * 触发生成某种语言。
   *
   * 【这是一个显式动作,不是我们替他决定的】学员切了语言之后旧 PDF **不自动重渲** ——
   * 一次点击触发一次 Lambda,而大多数人切了语言并不会立刻要 PDF。
   * 所以按钮上写清「生成英文版」,他知道自己在触发一次生成。
   */
  async function generateIn(lang: 'zh' | 'en') {
    setGenerating(lang);
    try {
      await requestReportFile(lang, attempt);
      // 服务端是同步等渲染完的,所以回来之后直接重取一次就能拿到新状态
      const fresh = await fetchReport(attempt);
      setData(fresh);
      setPdf({ status: fresh.pdfStatus, url: fresh.pdfUrl });
    } finally {
      setGenerating(null);
    }
  }


  /** 重取一次报告(重填被拒 / 放弃之后):按钮的位置与顶上那条提示跟着服务端的新状态走 */
  async function refreshReport() {
    try {
      const fresh = await fetchReport(attempt);
      setData(fresh);
      setPdf({ status: fresh.pdfStatus, url: fresh.pdfUrl });
      setNowMs(Date.now());
    } catch (err) {
      if (err instanceof QuizAuthError) onAuthLost();
    }
  }

  /** 每个动作失败的三种去向:登录失效 → /expired;链接作废 → 按钮的位置说「已作废」;别的 → 那个按钮旁边说没办成 */
  function onRetakeFailure(which: 'start' | 'continue' | 'abandon', kind: 'revoked' | 'authLost' | 'failed') {
    if (kind === 'authLost') return onAuthLost();
    if (kind === 'revoked') return setRevokedNow(true);
    setRetakeFailed(which);
  }

  /** 「重填测评」:先问(网站自己的确认框)→ start_retake → 新那一份的答题页 */
  function startRetake(action: Parameters<typeof retakeConfirmOptions>[1]) {
    void retakeGuard.run(async () => {
      setRetakeFailed(null);
      const out = await startRetakeFlow({
        ask,
        confirm: retakeConfirmOptions(tk, action),
        request: quizApi.startRetake,
        onRequest: (on) => setRetakeBusy(on ? 'start' : null),
        fallbackLocale: locale,
      });
      if (out.kind === 'started') return navigate(out.route);
      // 被拒:服务端什么都没写;重取一次,按钮的位置就说原因(太快 → 时间、满了、已经有一份没做完的)
      if (out.kind === 'refused') return refreshReport();
      if (out.kind !== 'cancelled') onRetakeFailure('start', out.kind);
    });
  }

  /** 「继续」:去那一份现在在的那一步(答题 / 问卷)。不改变任何东西,不问 */
  function continueRetake() {
    void retakeGuard.run(async () => {
      setRetakeFailed(null);
      setRetakeBusy('continue');
      try {
        const out = await continueRetakeFlow({ bootstrap: quizApi.bootstrap, fallbackLocale: locale });
        if (out.kind === 'go') return navigate(out.route);
        onRetakeFailure('continue', out.kind);
      } finally {
        setRetakeBusy(null);
      }
    });
  }

  /** 「放弃」:先问 → abandon_retake(服务端删掉没做完的那份)→ 重取一次,顶上那条消失、最下方回到「重填」 */
  function abandonRetake() {
    void retakeGuard.run(async () => {
      setRetakeFailed(null);
      const out = await abandonRetakeFlow({
        ask,
        confirm: abandonConfirmOptions(tk),
        request: quizApi.abandonRetake,
        onRequest: (on) => setRetakeBusy(on ? 'abandon' : null),
      });
      if (out.kind === 'abandoned' || out.kind === 'gone') return refreshReport();
      if (out.kind !== 'cancelled') onRetakeFailure('abandon', out.kind);
    });
  }

  /**
   * 分享卡按**这个页面自己的语言**从 `files` 里选,不再用端点的兼容投影
   * (`data.cardUrl`)。语言错了三次都是因为「谁决定语言」散在多层里 ——
   * 页面自己知道自己的语言,而 `files` 里两种都在,所以这一步是纯计算。
   */
  const cards = useMemo(
    () => cardsFor(data?.files ?? [], locale),
    [data, locale],
  );

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
          {showLoader && <PentagonLoader label={tk('report.loading')} />}
        </div>
      </Shell>
    );
  if (state === 'notReady') {
    // 看的是指定的一份而它不存在 / 没完成(服务端 404):不是「报告还没准备好」,是「没有这一份」
    if (attempt !== null) {
      return (
        <Shell>
          <Notice>
            <p>{tk('report.history.missing')}</p>
            <div className="mt-3">
              <Button variant="outline" onClick={() => navigate(`/report?lang=${locale}`)}>
                {tk('report.history.backToLatest')}
              </Button>
            </div>
          </Notice>
        </Shell>
      );
    }
    return <Shell><Notice>{tk('report.notReady')}</Notice></Shell>;
  }
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
  /**
   * 【定义在 api/_lib/surveySignals.ts,与问卷洞察页共用】
   * 原本这里是一句就地比较。问卷洞察页也要这个判断 —— 各写一份的话,
   * 同一个人可能在后台被标成「不一致」而在他自己的报告里没有,
   * 而那种不一致没有任何东西会报错。
   */
  const mismatch = isPriorityMismatch(priority, result.weakest);

  // 重填那四块:该不该出现、出现成什么样(lib/retakeView.ts)。PDF 渲染模式下全是 hidden / null
  const retakeCtx = { renderMode: isRenderMode(), revokedNow };
  const retake = retakeAction(data, retakeCtx);
  const banner = openRetakeBanner(data, retakeCtx);
  const history = historyItems(data, retakeCtx);
  const olderNote = historyNote(data, retakeCtx);
  const viewingOlder = olderNote !== null;
  const openAttempt = (n: number) => navigate(`/report?lang=${locale}&attempt=${n}`);
  const openLatest = () => navigate(`/report?lang=${locale}`);

  return (
    <Shell stagger={!isRenderMode()}>
      {/* 0. 有一份重填没做完:继续 / 放弃(关于人,不关于这一页) */}
      <ReportRetakeBanner
        banner={banner}
        busy={retakeBusy === 'continue' || retakeBusy === 'abandon' ? retakeBusy : null}
        failed={retakeFailed === 'continue' || retakeFailed === 'abandon'}
        onContinue={continueRetake}
        onAbandon={abandonRetake}
      />
      {/* 0.5 看的是以前的一份:是哪一次、什么时候;回到最新的一份 */}
      <ReportHistoryNote note={olderNote} onBack={openLatest} />

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
          baselineN={baseline.n}
          noBaselineLabel={tk('report.baseline.none')}
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
                    /**
                     * 红框 + 「优先」标记从原第 6 板块搬来 —— 那个板块已删(与本板块重复)。
                     * 红色专属「缺失 / 优先」,语义唯一;但只有【最弱两维】的缺失标「优先」,
                     * 否则低分者看到一整片红,报告读起来像判决书。标了优先的这几项,
                     * 正好对应 30 天清单里的动作,两块因此连起来。
                     */
                    const isMissing = badge === 'missing';
                    const isPriority = isMissing && weakSet.has(d.key);
                    return (
                      <div
                        key={i}
                        className={[
                          'border-brutal p-2 font-body text-sm',
                          isMissing ? 'qai-alert-border' : 'border-line',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-2">
                          <SubmoduleMark state={MARK[badge]} label={badgeLabel(badge)} />
                          <span className="font-bold">{label}</span>
                          {isPriority && (
                            <span className="ml-auto shrink-0 qai-alert-fill px-1.5 py-0.5 font-head text-xs font-bold">
                              {tk('report.badge.priority')}
                            </span>
                          )}
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

      {/* 6. 30 天行动清单 */}
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

      {/* 7. 下一步(offer) + mismatch 高亮 */}
      <NextStep weakest={result.weakest[0]} locale={locale} L={L} mismatch={mismatch}
        priorityLabel={priority ? dimLabel(priority) : ''} needLabel={dimLabel(result.weakest[0])} tk={tk} />

      {/*
        8.5 分享卡 —— **整块只在图真的存在时才渲**。
        没出来就当它不存在:这是附属品的附属品,为它显示一句「生成失败」
        只会让客户去操心一件与他的报告无关的事。失败要被看见的地方是 Admin 名单页。
      */}
      {(cards.cardUrl || cards.cardTallUrl) && (
        <Section title={tk('report.card.title')}>
          <p className="mb-3 font-body text-sm opacity-70">{tk('report.card.hint')}</p>
          <div className="flex flex-wrap gap-4">
            {cards.cardUrl && (
              <figure className="w-52">
                <img
                  src={cards.cardUrl}
                  alt={tk('report.card.square')}
                  className="w-full border-brutal border-line"
                />
                <figcaption className="mt-1 font-body text-xs opacity-60">
                  {tk('report.card.square')}
                </figcaption>
              </figure>
            )}
            {cards.cardTallUrl && (
              <figure className="w-36">
                <img
                  src={cards.cardTallUrl}
                  alt={tk('report.card.tall')}
                  className="w-full border-brutal border-line"
                />
                <figcaption className="mt-1 font-body text-xs opacity-60">
                  {tk('report.card.tall')}
                </figcaption>
              </figure>
            )}
          </div>
        </Section>
      )}

      {/* 8. PDF / 打印 —— PDF 渲染与打印时整节不出现,见 ReportTakeaway.tsx */}
      <ReportTakeaway
        renderMode={isRenderMode()}
        files={data?.files ?? []}
        current={locale}
        currentStatus={pdf.status}
        pollDone={pollDone}
        opening={opening}
        generating={generating}
        onOpen={(l) => void openFlight.run(() => openPdfIn(l))}
        onGenerate={(l) => void generateFlight.run(() => generateIn(l))}
        onPrint={() => window.print()}
        history={viewingOlder}
      />

      {/* 9. 历次结果(两份以上):点一份看那一份的报告 */}
      <ReportHistory items={history} onOpen={openAttempt} />

      {/* 10. 最下方:重填测评 / 不能重填的原因 / 继续重填 */}
      <ReportRetakeSection
        action={retake}
        nowMs={nowMs}
        busy={retakeBusy === 'start' || (retake.kind === 'continue' && retakeBusy === 'continue')}
        failed={retakeFailed === 'start' || (retake.kind === 'continue' && retakeFailed === 'continue')}
        onStart={() => retake.kind === 'start' && startRetake(retake)}
        onContinue={continueRetake}
      />
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
  const route = (
    config.offer_routing as unknown as Record<string, { product: string; zh_cta: string; en_cta: string }>
  )[weakest];
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
            {/*
              【走 L(zh, en),与 tiers 的 zh_desc/en_desc 同一套】
              上一版直接渲 `route.zh_cta` —— 那不是「漏翻」,是**结构上没有 en 的位置**:
              config 里当时只有 `zh_cta`。所以英文 PDF 第 5 页会出现
              英文产品名 + 中文 CTA 并排。
              `grep en` 找不到这一类缺口(那个键根本不存在),只有真渲一次英文版才看得见。
            */}
            <p className="font-body leading-relaxed">{L(route.zh_cta, route.en_cta)}</p>
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
    // 浅黄 = 黄色 40%。不能写 bg-accent/40:accent 是 CSS 变量,Tailwind 加不了透明度,那个类不生成(原来「中」就是白底,和「低」一样)
    medium: 'bg-[color-mix(in_srgb,var(--qai-accent)_40%,transparent)] text-ink',
    high: 'bg-accent text-accent-fg',
  };
  const tone = (kind === 'difficulty' ? difficulty : impact)[value] ?? 'bg-paper text-ink';
  return <span className={`border-brutal border-line px-2 py-0.5 font-head font-bold ${tone}`}>{label}</span>;
}

function Shell({ children, stagger = false }: { children: React.ReactNode; stagger?: boolean }) {
  // stagger:报告的块依次淡入(间隔 50ms,600ms 内到位,见 motion.css)。渲染模式下不开
  return (
    <main className="min-h-screen bg-muted p-4 md:p-8">
      <div className={`mx-auto max-w-2xl space-y-6${stagger ? ' qai-stagger' : ''}`}>{children}</div>
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
