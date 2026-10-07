import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import config from '@/config/assessment-config.json';
import { Badge, Button, Card, CardBody, Progress, RadioCard, RadioGroup } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { scrollBehavior } from '@/lib/motion';
import { nextStep, progress, segmentAdvance } from '@/lib/quizFlow';
import { quizApi, QuizAuthError, type QuizSnapshot } from '@/lib/quizApi';
import { createSaveTracker, failedSummary, retryChoice, saveView, type SaveState } from '@/lib/saveStatus';
import { routeForStatus, SessionGuardError, type GuardError } from '@/lib/sessionFlow';
import { rerouteToCurrentSession } from '@/lib/sessionReroute';
import { useDelayedFlag } from '@/lib/useBusy';
import { canReveal, useReveal, useTransitionNavigate } from '@/lib/usePageMotion';

const PROFILE = config.profile_questions;
const QUESTIONS = config.questions;
const DIMENSIONS = config.dimensions;
const PROFILE_IDS = PROFILE.map((p) => p.id);
const QUESTION_IDS = QUESTIONS.map((q) => q.id);
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

/** 页面上的分段,按出现顺序:背景题一段,五维各一段。自动滑到下一段、失败提示的顺序都按它 */
const SEGMENTS: string[][] = [
  PROFILE_IDS,
  ...DIMENSIONS.map((d) => QUESTIONS.filter((q) => q.dimension === d.key).map((q) => q.id)),
];
const PAGE_ORDER = SEGMENTS.flat();

/**
 * 答题页 —— v3:滚动式表单 + 乐观保存。
 *
 * 【为什么从「一题一屏 + 等确认」改过来】这是 survey 不是考试。一题一屏 + 每题等服务端
 * 确认才能前进,把一个三分钟的填表拉成一场考试。v3 改为:所有题在一页内滚动(背景题
 * 一段 + 五维各一段),点选即刻生效,保存在后台异步进行,不阻塞下一题。
 *
 * 【乐观保存下断点续答仍然成立】关键没变:进来先 bootstrap 拉服务端快照回填,
 * 并滚动定位到第一个未答。区别只是「点了之后不等确认」—— 每题的保存结果单独跟踪,
 * 提交时统一校验有没有没答的、没存上的,有则定位过去。
 *
 * 【为什么防跳题的旧约束可以去掉】旧的「等确认再前进」是为了防止本地计数器漂移导致
 * 跳题。滚动式下题目全都在页面上、可以任意顺序答,跳题本来就允许 —— 那个约束失去意义。
 * 而「答案会不会丢」由提交前的统一校验兜住,不再依赖每题阻塞。
 */
export default function Quiz() {
  const { tk, locale } = useT();
  // 换页走 View Transitions(旧页淡出、新页淡入上移);签名与 navigate 相同
  const navigate = useTransitionNavigate();
  const [snapshot, setSnapshot] = useState<QuizSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 本地答案(乐观):key → optionIndex。key 是 profile id 或 question id */
  const [answers, setAnswers] = useState<Record<string, number>>({});
  /** 每个 key 的后台保存状态 */
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  /** 提交时的整体提示 */
  const [submitNote, setSubmitNote] = useState<string | null>(null);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** 题目区的容器 —— 分段「进入视口才淡入」在它里面找 data-reveal */
  const contentRef = useRef<HTMLDivElement>(null);
  /** 提交区 —— 全部答完时滑到这里 */
  const submitRef = useRef<HTMLDivElement>(null);
  /** 同一题连着改选时,只让最后发出的那次保存决定这一题显示什么(见 lib/saveStatus.ts) */
  const saves = useRef(createSaveTracker()).current;
  /** 这个页面加载时属于哪个 session —— 每次写入都带上,见 api/_lib/sessionGuard.ts */
  const sessionIdRef = useRef<string | null>(null);
  /** 写入守卫回了 session_changed:这个页面已过期,正在按当前登录重新分流 */
  const [pageExpired, setPageExpired] = useState(false);

  const onAuthLost = useCallback(() => {
    navigate(`/expired?lang=${locale}`, { replace: true });
  }, [navigate, locale]);

  /** 写入被守卫拦下:已完成 → 去报告页;页面属于别的 session → 提示后整页重新分流 */
  const onGuard = useCallback(
    (kind: GuardError) => {
      if (kind === 'already_completed') {
        navigate(routeForStatus('completed', locale), { replace: true });
        return;
      }
      setPageExpired(true);
      window.setTimeout(() => void rerouteToCurrentSession(locale), 1500);
    },
    [navigate, locale],
  );

  useEffect(() => {
    let alive = true;
    void quizApi
      .bootstrap()
      .then((s) => {
        if (!alive) return;
        // 已经交卷了:不再显示题目(否则改一个选项就会写进一份已完成的测评)
        if (s.status === 'completed') {
          navigate(routeForStatus('completed', locale), { replace: true });
          return;
        }
        sessionIdRef.current = s.sessionId;
        setSnapshot(s);
        // 回填服务端已有的答案,并标记为已保存
        const merged = { ...s.profile, ...s.answers };
        setAnswers(merged);
        setSaveState(Object.fromEntries(Object.keys(merged).map((k) => [k, 'saved'])));
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof QuizAuthError) return onAuthLost();
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [onAuthLost, navigate, locale]);

  const answeredSet = useMemo(() => new Set(Object.keys(answers)), [answers]);
  const bar = useMemo(() => progress(PROFILE_IDS, QUESTION_IDS, answeredSet), [answeredSet]);
  const failed = failedSummary(PAGE_ORDER, saveState);

  useReveal(contentRef, snapshot !== null);
  /** 「加载中」等满 150ms 才出现 —— 快的时候直接是题目,不闪一下字 */
  const showLoading = useDelayedFlag(snapshot === null && loadError === null && !pageExpired);

  /** 进来后滚动到第一个未答项(断点续答的定位)。只在快照首次到达时跳一次 */
  useEffect(() => {
    if (!snapshot) return;
    const step = nextStep(PROFILE_IDS, QUESTION_IDS, new Set(Object.keys({ ...snapshot.profile, ...snapshot.answers })));
    if (step.phase === 'done') return;
    const id = step.phase === 'profile' ? PROFILE_IDS[step.index] : QUESTION_IDS[step.index];
    cardRefs.current[id]?.scrollIntoView({ block: 'center' });
  }, [snapshot]);

  /**
   * 存一题(点选与「重试」共用)。保存状态立刻变成「保存中」,请求在后台;
   * 状态徽章与失败提示随状态出现,不进任何动画(见 lib/saveStatus.ts)。
   */
  function save(kind: 'profile' | 'question', id: string, optionIndex: number, onSaved?: () => void) {
    setSaveState((prev) => ({ ...prev, [id]: 'saving' }));
    setSubmitNote(null);

    const sessionId = sessionIdRef.current ?? '';
    const ticket = saves.begin(id);
    const call =
      kind === 'profile'
        ? quizApi.saveProfile(id, optionIndex, sessionId)
        : quizApi.saveAnswer(id, optionIndex, sessionId);
    void call
      .then(() => {
        if (!saves.isLatest(id, ticket)) return;
        setSaveState((prev) => ({ ...prev, [id]: 'saved' }));
        onSaved?.();
      })
      .catch((err) => {
        // 登录失效 / 页面已过期:不管是不是最新那次,都要处理
        if (err instanceof QuizAuthError) return onAuthLost();
        if (err instanceof SessionGuardError) return onGuard(err.kind);
        if (!saves.isLatest(id, ticket)) return;
        // 不回滚本地选择 —— 客户看得见自己选了什么;卡片上的「重试」重发这一项
        setSaveState((prev) => ({ ...prev, [id]: 'error' }));
      });
  }

  /** 乐观保存:立刻更新本地,后台异步存,单独跟踪每题结果。这一下答完一整段 → 存上之后滑到下一段 */
  function choose(kind: 'profile' | 'question', id: string, optionIndex: number) {
    const target = segmentAdvance(SEGMENTS, answeredSet, id);
    setAnswers((prev) => ({ ...prev, [id]: optionIndex }));
    const tappedAt = performance.now();
    const scrollAt = window.scrollY;
    save(kind, id, optionIndex, target ? () => glideTo(target, tappedAt, scrollAt) : undefined);
  }

  /** 重发学员选的那一项 —— 同一个选项再点一次 Radix 不会回调,所以要有这个按钮 */
  function retry(kind: 'profile' | 'question', id: string) {
    const optionIndex = retryChoice(id, answers, saveState);
    if (optionIndex !== null) save(kind, id, optionIndex);
  }

  /**
   * 一段答完、这一题也存上了 → 平滑滑到下一段(下一段进入视口时淡入)。
   * - 等保存成功才滑:没存上就留在原地,失败提示和「重试」就在眼前
   * - 等待期间人自己滚过页面(超过 48px)就不滑:不跟人抢方向
   * - 点下去至少 300ms 后才滑:先让人看见选中与「已保存」
   */
  function glideTo(target: string, tappedAt: number, scrollAt: number) {
    const wait = Math.max(0, 300 - (performance.now() - tappedAt));
    window.setTimeout(() => {
      if (Math.abs(window.scrollY - scrollAt) > 48) return;
      const el = target === 'submit' ? submitRef.current : cardRefs.current[target];
      el?.scrollIntoView({ behavior: scrollBehavior(), block: target === 'submit' ? 'center' : 'start' });
    }, wait);
  }

  function jumpTo(id: string) {
    // 减少动态效果时直接跳到位置(scrollBehavior),不平滑滚
    cardRefs.current[id]?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  }

  /** 还有答案在后台保存 */
  const saving = Object.values(saveState).some((st) => st === 'saving');
  /** 全部答完且全部落库才允许提交 —— 与按钮的视觉承诺一致 */
  const canSubmit =
    !saving && [...PROFILE_IDS, ...QUESTION_IDS].every((id) => id in answers && saveState[id] !== 'error');

  function submit() {
    const all = [...PROFILE_IDS, ...QUESTION_IDS];
    // 1. 有没有没答的
    const unanswered = all.filter((id) => !(id in answers));
    if (unanswered.length) {
      setSubmitNote(tk('quiz.unanswered').replace('{n}', String(unanswered.length)));
      jumpTo(unanswered[0]);
      return;
    }
    // 2. 有没有还在保存的 —— 别把没落库的当成答完
    if (Object.values(saveState).some((s) => s === 'saving')) {
      setSubmitNote(tk('quiz.stillSaving'));
      return;
    }
    // 3. 有没有保存失败的 —— 定位到第一个,重选即重试
    const failed = all.filter((id) => saveState[id] === 'error');
    if (failed.length) {
      setSubmitNote(tk('quiz.someFailed').replace('{n}', String(failed.length)));
      jumpTo(failed[0]);
      return;
    }
    navigate(`/survey?lang=${locale}`, { replace: true });
  }

  if (pageExpired) {
    return (
      <Shell>
        <Card tone="accent" padding="md">
          <CardBody className="font-body">
            <p>{tk('session.changed')}</p>
          </CardBody>
        </Card>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <Card tone="accent" padding="md">
          <CardBody className="space-y-3 font-body">
            <p>{tk('quiz.loadFailed')}</p>
            <p className="text-sm opacity-70">{loadError}</p>
            <Button onClick={() => window.location.reload()}>{tk('common.retry')}</Button>
          </CardBody>
        </Card>
      </Shell>
    );
  }

  if (!snapshot) {
    return <Shell>{showLoading && <p className="font-body">{tk('common.loading')}</p>}</Shell>;
  }

  return (
    <Shell contentRef={contentRef} reveal>
      {/* 进度条固定在顶部,滚动时始终可见 */}
      <div className="sticky top-0 z-10 -mx-4 bg-muted px-4 py-3 md:-mx-8 md:px-8">
        <Progress
          value={bar.pct}
          caption={tk('progress.of')
            .replace('{current}', String(bar.done))
            .replace('{total}', String(bar.total))}
        />
        {/* 哪一题没存上,不管它在页面哪里,这里都看得见;点一下去第一题,那张卡上有「重试」 */}
        {failed && (
          <button
            type="button"
            onClick={() => jumpTo(failed.first)}
            className="qai-lift mt-3 w-full border-brutal border-line bg-accent px-3 py-2 text-left font-body text-sm font-bold text-accent-fg"
          >
            {tk('quiz.failedNotice').replace('{n}', String(failed.count))}
          </button>
        )}
      </div>

      <p className="font-body text-sm opacity-70">{tk('quiz.intro')}</p>

      <Section title={tk('quiz.profileSectionTitle')}>
        {PROFILE.map((p) => (
          <QuestionCard
            key={p.id}
            registerRef={(el) => (cardRefs.current[p.id] = el)}
            question={locale === 'en' ? p.en.q : p.zh.q}
            options={locale === 'en' ? p.en.options : p.zh.options}
            selected={answers[p.id]}
            state={saveState[p.id]}
            onChoose={(i) => choose('profile', p.id, i)}
            onRetry={() => retry('profile', p.id)}
            savedLabel={tk('quiz.saved')}
            savingLabel={tk('quiz.savingOne')}
            errorLabel={tk('quiz.saveOneFailed')}
            retryLabel={tk('common.retry')}
          />
        ))}
      </Section>

      {DIMENSIONS.map((d) => (
        <Section key={d.key} title={locale === 'en' ? d.en : d.zh} color={d.color}>
          {QUESTIONS.filter((q) => q.dimension === d.key).map((q) => (
            <QuestionCard
              key={q.id}
              registerRef={(el) => (cardRefs.current[q.id] = el)}
              question={locale === 'en' ? q.en.q : q.zh.q}
              options={locale === 'en' ? q.en.options : q.zh.options}
              selected={answers[q.id]}
              state={saveState[q.id]}
              onChoose={(i) => choose('question', q.id, i)}
              onRetry={() => retry('question', q.id)}
              savedLabel={tk('quiz.saved')}
              savingLabel={tk('quiz.savingOne')}
              errorLabel={tk('quiz.saveOneFailed')}
              retryLabel={tk('common.retry')}
            />
          ))}
        </Section>
      ))}

      <div ref={submitRef} className="space-y-3 pb-16">
        {submitNote && (
          <div className="border-brutal border-line bg-accent p-3 font-body text-sm">{submitNote}</div>
        )}
        <p className="font-body text-xs opacity-50">{tk('quiz.autosaveNote')}</p>
        {/**
          * 【按钮状态就是承诺,不能用文字去纠正】亮着的按钮 + 一行「还有答案在保存」的字,
          * 是在用文字纠正一个视觉承诺,而人先看颜色再读字。所以:没答完或还在保存时
          * 直接置灰禁用,全部落库才变黄可点。
          */}
        <Button variant="primary" block onClick={submit} disabled={!canSubmit}>
          {saving ? tk('quiz.savingOne') : tk('quiz.submit')}
        </Button>
      </div>
    </Shell>
  );
}

function Section({ title, color, children }: { title: string; color?: string; children: React.ReactNode }) {
  // data-reveal:进入视口时淡入(页面内分段的转场,见 usePageMotion.useReveal 与 motion.css)
  return (
    <section data-reveal className="space-y-4">
      <h2 className="flex items-center gap-3 font-head text-lg font-bold uppercase tracking-tight">
        {/* 维度色只作带墨边框的小方块,不作文字色(check:dim 的规矩) */}
        {color && (
          <span className="h-4 w-4 border-brutal border-line" style={{ backgroundColor: color }} aria-hidden />
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

function QuestionCard({
  registerRef,
  question,
  options,
  selected,
  state,
  onChoose,
  onRetry,
  savedLabel,
  savingLabel,
  errorLabel,
  retryLabel,
}: {
  registerRef: (el: HTMLDivElement | null) => void;
  question: string;
  options: string[];
  selected: number | undefined;
  state: SaveState | undefined;
  onChoose: (i: number) => void;
  onRetry: () => void;
  savedLabel: string;
  savingLabel: string;
  errorLabel: string;
  retryLabel: string;
}) {
  const view = saveView(state);
  return (
    // scroll-mt:自动滑到这一题时,让出顶上那条 sticky 进度栏和段标题
    <div ref={registerRef} className="scroll-mt-28">
      <Card shadow="base" padding="md" tone={view.failed ? 'accent' : 'paper'}>
        <CardBody className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-head text-base font-bold leading-snug md:text-lg">{question}</h3>
            {view.badge === 'saved' && <Badge tone="muted">{savedLabel}</Badge>}
            {view.badge === 'saving' && <Badge tone="muted">{savingLabel}</Badge>}
          </div>
          <RadioGroup
            value={selected === undefined ? '' : String(selected)}
            onValueChange={(v) => onChoose(Number(v))}
          >
            {options.map((option, i) => (
              <RadioCard key={i} value={String(i)} label={option} index={LETTERS[i]} />
            ))}
          </RadioGroup>
          {view.failed && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-body text-sm font-bold">{errorLabel}</p>
              {view.retry && (
                <Button size="sm" variant="solid" onClick={onRetry}>
                  {retryLabel}
                </Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Shell({
  children,
  contentRef,
  reveal = false,
}: {
  children: React.ReactNode;
  contentRef?: React.RefObject<HTMLDivElement>;
  /** 里面的 data-reveal 块进入视口才淡入 —— 浏览器没有 IntersectionObserver 就不开(什么都不藏) */
  reveal?: boolean;
}) {
  return (
    <main className="min-h-screen bg-muted p-4 md:p-8">
      <div ref={contentRef} className={`mx-auto max-w-2xl space-y-8${reveal && canReveal ? ' qai-reveal-on' : ''}`}>
        {children}
      </div>
    </main>
  );
}
