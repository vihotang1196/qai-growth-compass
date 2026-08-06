import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import config from '@/config/assessment-config.json';
import { Badge, Button, Card, CardBody, Progress, RadioCard, RadioGroup } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { nextStep, progress } from '@/lib/quizFlow';
import { quizApi, QuizAuthError, type QuizSnapshot } from '@/lib/quizApi';

const PROFILE = config.profile_questions;
const QUESTIONS = config.questions;
const DIMENSIONS = config.dimensions;
const PROFILE_IDS = PROFILE.map((p) => p.id);
const QUESTION_IDS = QUESTIONS.map((q) => q.id);
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

/** 每个 key 的后台保存状态 */
type SaveState = 'saving' | 'saved' | 'error';

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
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<QuizSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 本地答案(乐观):key → optionIndex。key 是 profile id 或 question id */
  const [answers, setAnswers] = useState<Record<string, number>>({});
  /** 每个 key 的后台保存状态 */
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  /** 提交时的整体提示 */
  const [submitNote, setSubmitNote] = useState<string | null>(null);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const onAuthLost = useCallback(() => {
    navigate(`/expired?lang=${locale}`, { replace: true });
  }, [navigate, locale]);

  useEffect(() => {
    let alive = true;
    void quizApi
      .bootstrap()
      .then((s) => {
        if (!alive) return;
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
  }, [onAuthLost]);

  const answeredSet = useMemo(() => new Set(Object.keys(answers)), [answers]);
  const bar = useMemo(() => progress(PROFILE_IDS, QUESTION_IDS, answeredSet), [answeredSet]);

  /** 进来后滚动到第一个未答项(断点续答的定位)。只在快照首次到达时跳一次 */
  useEffect(() => {
    if (!snapshot) return;
    const step = nextStep(PROFILE_IDS, QUESTION_IDS, new Set(Object.keys({ ...snapshot.profile, ...snapshot.answers })));
    if (step.phase === 'done') return;
    const id = step.phase === 'profile' ? PROFILE_IDS[step.index] : QUESTION_IDS[step.index];
    cardRefs.current[id]?.scrollIntoView({ block: 'center' });
  }, [snapshot]);

  /** 乐观保存:立刻更新本地,后台异步存,单独跟踪每题结果 */
  function choose(kind: 'profile' | 'question', id: string, optionIndex: number) {
    setAnswers((prev) => ({ ...prev, [id]: optionIndex }));
    setSaveState((prev) => ({ ...prev, [id]: 'saving' }));
    setSubmitNote(null);

    const call =
      kind === 'profile' ? quizApi.saveProfile(id, optionIndex) : quizApi.saveAnswer(id, optionIndex);
    void call
      .then(() => setSaveState((prev) => ({ ...prev, [id]: 'saved' })))
      .catch((err) => {
        if (err instanceof QuizAuthError) return onAuthLost();
        // 不回滚本地选择 —— 客户看得见自己选了什么,再点一下即重试
        setSaveState((prev) => ({ ...prev, [id]: 'error' }));
      });
  }

  function jumpTo(id: string) {
    cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    return (
      <Shell>
        <p className="font-body">{tk('common.loading')}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* 进度条固定在顶部,滚动时始终可见 */}
      <div className="sticky top-0 z-10 -mx-4 bg-muted px-4 py-3 md:-mx-8 md:px-8">
        <Progress
          value={bar.pct}
          caption={tk('progress.of')
            .replace('{current}', String(bar.done))
            .replace('{total}', String(bar.total))}
        />
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
            savedLabel={tk('quiz.saved')}
            savingLabel={tk('quiz.savingOne')}
            errorLabel={tk('quiz.saveOneFailed')}
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
              savedLabel={tk('quiz.saved')}
              savingLabel={tk('quiz.savingOne')}
              errorLabel={tk('quiz.saveOneFailed')}
            />
          ))}
        </Section>
      ))}

      <div className="space-y-3 pb-16">
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
  return (
    <section className="space-y-4">
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
  savedLabel,
  savingLabel,
  errorLabel,
}: {
  registerRef: (el: HTMLDivElement | null) => void;
  question: string;
  options: string[];
  selected: number | undefined;
  state: SaveState | undefined;
  onChoose: (i: number) => void;
  savedLabel: string;
  savingLabel: string;
  errorLabel: string;
}) {
  return (
    <div ref={registerRef}>
      <Card shadow="base" padding="md" tone={state === 'error' ? 'accent' : 'paper'}>
        <CardBody className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-head text-base font-bold leading-snug md:text-lg">{question}</h3>
            {state === 'saved' && <Badge tone="muted">{savedLabel}</Badge>}
            {state === 'saving' && <Badge tone="muted">{savingLabel}</Badge>}
          </div>
          <RadioGroup
            value={selected === undefined ? '' : String(selected)}
            onValueChange={(v) => onChoose(Number(v))}
          >
            {options.map((option, i) => (
              <RadioCard key={i} value={String(i)} label={option} index={LETTERS[i]} />
            ))}
          </RadioGroup>
          {state === 'error' && <p className="font-body text-sm font-bold">{errorLabel}</p>}
        </CardBody>
      </Card>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-muted p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-8">{children}</div>
    </main>
  );
}
