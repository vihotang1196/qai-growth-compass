import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import config from '@/config/assessment-config.json';
import { Button, Card, CardBody, Progress, RadioCard, RadioGroup } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { nextStep, progress, type QuizStep } from '@/lib/quizFlow';
import { quizApi, QuizAuthError, type QuizSnapshot } from '@/lib/quizApi';

const PROFILE = config.profile_questions;
const QUESTIONS = config.questions;
const PROFILE_IDS = PROFILE.map((p) => p.id);
const QUESTION_IDS = QUESTIONS.map((q) => q.id);
/** A B C D —— 选项前的字母,纯装饰 */
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * 答题页 —— 3 道背景题 + 24 道测评题,单题单屏。
 *
 * 【下一题由服务端快照决定,不由本地计数器决定】
 *
 * 这是这个页面唯一重要的设计决定。本地计数器会漂移:一次保存失败、一次刷新、
 * 一次后退,本地的「第几题」就和库里的已答集合分家了。而分家之后的表现是
 * 「跳过了一题」—— 那道题的答案缺失一路走到算分,分母写死 12,那一维被静默低估,
 * 最终 offer 分流指向错误的产品。见 lib/quizFlow.ts 的注释。
 *
 * 所以:每次作答【等服务端确认】,然后用返回的快照重算下一题。
 * 代价是每题一次往返的等待;换来的是刷新、断线、后退全都自动正确 ——
 * 因为「我在哪」这个问题从来不由客户端回答。
 */
export default function Quiz() {
  const { tk, locale } = useT();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<QuizSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** 已选但还没存成的下标 —— 只用于让被点的那一项立刻有选中态 */
  const [optimistic, setOptimistic] = useState<number | null>(null);

  /**
   * 【401 与 403 都跳 /expired,刻意不带参数】
   *
   * 与后台那边正好相反:后台必须区分 401 / 403,否则不在名单的人会陷入
   * 「登录成功 → 被弹回」的死循环。这里不区分,因为客户能做的动作只有一个 ——
   * 联系我们重发。而告诉他「你的准入被停用了」是泄露内部状态,
   * 对他没有帮助,只会让他去问「为什么停用我」。
   *
   * 所以这个回调不需要知道是哪一种。第一版带了个 kind 参数,tsc 报它没被用到 ——
   * 那说明它确实是死的,不是「以后可能有用」。
   */
  const onAuthLost = useCallback(() => {
    navigate(`/expired?lang=${locale}`, { replace: true });
  }, [navigate, locale]);

  useEffect(() => {
    let alive = true;
    void quizApi
      .bootstrap()
      .then((s) => {
        if (alive) setSnapshot(s);
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

  const answeredSet = useMemo(() => {
    if (!snapshot) return new Set<string>();
    return new Set([...Object.keys(snapshot.profile), ...Object.keys(snapshot.answers)]);
  }, [snapshot]);

  const step: QuizStep = useMemo(
    () => nextStep(PROFILE_IDS, QUESTION_IDS, answeredSet),
    [answeredSet],
  );
  const bar = useMemo(() => progress(PROFILE_IDS, QUESTION_IDS, answeredSet), [answeredSet]);

  // 答满之后交给 Stage 9 的问卷环节
  useEffect(() => {
    if (step.phase === 'done') navigate(`/survey?lang=${locale}`, { replace: true });
  }, [step.phase, navigate, locale]);

  async function choose(optionIndex: number) {
    if (pending || step.phase === 'done') return;
    setPending(true);
    setSaveError(null);
    setOptimistic(optionIndex);
    try {
      const next =
        step.phase === 'profile'
          ? await quizApi.saveProfile(PROFILE[step.index].id, optionIndex)
          : await quizApi.saveAnswer(QUESTIONS[step.index].id, optionIndex);
      // 用服务端返回的快照推进,不用本地状态
      setSnapshot(next);
      setOptimistic(null);
    } catch (err) {
      if (err instanceof QuizAuthError) return onAuthLost();
      /**
       * 【保存失败时不前进】前进会让这一题的答案永久缺失,而客户不会知道。
       * 停在原地并给出重试,是唯一诚实的处理 —— 客户看得见「这一步没成」。
       */
      setOptimistic(null);
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
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

  if (!snapshot || step.phase === 'done') {
    return (
      <Shell>
        <p className="font-body">{tk('common.loading')}</p>
      </Shell>
    );
  }

  const isProfile = step.phase === 'profile';
  const item = isProfile ? PROFILE[step.index] : QUESTIONS[step.index];
  const copy = locale === 'en' ? item.en : item.zh;
  const savedIndex = isProfile ? snapshot.profile[item.id] : snapshot.answers[item.id];
  const selected = optimistic ?? savedIndex;

  return (
    <Shell>
      <div className="space-y-6">
        <Progress
          value={bar.pct}
          // 用已有的 progress.of,不新造一个键 —— 同一句话两个键,迟早只改一个
          caption={tk('progress.of')
            .replace('{current}', String(bar.done))
            .replace('{total}', String(bar.total))}
        />

        {/* 背景题与测评题视觉上区分开,让客户知道正题还没开始 */}
        <p className="font-head text-sm font-bold uppercase tracking-wide opacity-60">
          {isProfile ? tk('quiz.profileSection') : tk('quiz.questionSection')}
        </p>

        <Card shadow="lg" padding="md">
          <CardBody className="space-y-6">
            <h1 className="font-head text-xl font-bold leading-snug md:text-2xl">{copy.q}</h1>

            <RadioGroup
              value={selected === undefined ? '' : String(selected)}
              onValueChange={(v) => void choose(Number(v))}
              disabled={pending}
            >
              {copy.options.map((option, i) => (
                <RadioCard
                  key={i}
                  value={String(i)}
                  label={option}
                  index={LETTERS[i]}
                  disabled={pending}
                />
              ))}
            </RadioGroup>

            {pending && <p className="font-body text-sm opacity-60">{tk('quiz.saving')}</p>}

            {saveError && (
              <div className="space-y-2 border-brutal border-line bg-accent p-3">
                <p className="font-body text-sm">{tk('quiz.saveFailed')}</p>
                <p className="font-body text-xs opacity-70">{saveError}</p>
                {/* 重试用刚才那个下标,不让客户重新找一遍自己选的是哪个 */}
                <Button
                  size="sm"
                  onClick={() => void choose(selected ?? 0)}
                  disabled={pending || selected === undefined}
                >
                  {tk('common.retry')}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        <p className="font-body text-xs opacity-50">{tk('quiz.autosaveNote')}</p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-muted p-4 md:p-8">
      <div className="mx-auto max-w-2xl">{children}</div>
    </main>
  );
}
