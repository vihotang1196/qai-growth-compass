import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import config from '@/config/assessment-config.json';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Progress,
  RadioCard,
  RadioGroup,
  Textarea,
} from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { QuizAuthError } from '@/lib/quizApi';
import { SurveyValidationError, surveyApi } from '@/lib/surveyApi';

const SURVEY = config.survey_questions;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

type Answer = number | number[] | string;

/**
 * 问卷页 —— 7 题,三种题型(single_select / multi_select / open_text)。
 *
 * 【与答题页不同:这里在本地攒完再一次提交】答题页每题即存,因为 20 题掉线要重来
 * 代价太大。问卷只有 7 题、大约一分钟,而且它是【报告之前的最后一步】——
 * 逐题往返会在客户最接近终点的地方加 7 次等待。攒完一次提交,失败时内容还在页面上。
 *
 * 【提交是两步:save 再 finalize】save 存问卷,finalize 算分写结果。
 * 分开是因为 finalize 会拒绝「测评题没答满」,而那时问卷内容应该已经存住了 ——
 * 不然客户填完 7 题被打回去补测评题,回来还要重填一遍。
 */
export default function Survey() {
  const { tk, locale } = useT();
  const navigate = useNavigate();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 服务端指名的那一题 —— 用来把客户直接送回那一屏 */
  const [badQuestion, setBadQuestion] = useState<string | null>(null);

  const onAuthLost = useCallback(() => {
    navigate(`/expired?lang=${locale}`, { replace: true });
  }, [navigate, locale]);

  const q = SURVEY[index];
  const copy = locale === 'en' ? q.en : q.zh;
  const answer = answers[q.id];
  const isLast = index === SURVEY.length - 1;

  /** 当前这题是否已满足 required —— 决定「下一题」能不能点 */
  const satisfied = useMemo(() => {
    if (!q.required) return true;
    if (q.type === 'multi_select') return Array.isArray(answer) && answer.length > 0;
    if (q.type === 'open_text') return typeof answer === 'string' && answer.trim() !== '';
    return typeof answer === 'number';
  }, [q, answer]);

  const set = (value: Answer) => {
    setAnswers((prev) => ({ ...prev, [q.id]: value }));
    setError(null);
  };

  function toggleMulti(i: number) {
    const current = Array.isArray(answer) ? answer : [];
    set(current.includes(i) ? current.filter((x) => x !== i) : [...current, i]);
  }

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    setBadQuestion(null);
    try {
      // 只提交有值的题 —— 选填留空时不该出现在 payload 里
      const payload: Record<string, Answer> = {};
      for (const [id, v] of Object.entries(answers)) {
        if (v === '' || (Array.isArray(v) && v.length === 0)) continue;
        payload[id] = v;
      }
      await surveyApi.save(payload);
      await surveyApi.finalize();
      navigate(`/report?lang=${locale}`, { replace: true });
    } catch (err) {
      if (err instanceof QuizAuthError) return onAuthLost();
      if (err instanceof SurveyValidationError) {
        if (err.code === 'incomplete') {
          // 测评题没答满 —— 问卷已经存住了,回去补完再回来不用重填
          setError(tk('survey.incomplete'));
        } else if (err.code === 'too_long' && err.max !== undefined) {
          setError(tk('survey.tooLong').replace('{max}', String(err.max)));
        } else {
          setError(tk('survey.required'));
        }
        // 服务端指名了哪一题就送客户回那一屏 —— 让他改的是出问题的那题,
        // 而不是自己从头找一遍
        if (err.questionId) {
          const at = SURVEY.findIndex((s) => s.id === err.questionId);
          if (at >= 0) setIndex(at);
          setBadQuestion(err.questionId);
        }
        return;
      }
      setError(tk('survey.saveFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <Progress
          value={Math.round(((index + 1) / SURVEY.length) * 100)}
          caption={tk('survey.progress')
            .replace('{current}', String(index + 1))
            .replace('{total}', String(SURVEY.length))}
        />

        <div>
          <p className="font-head text-sm font-bold uppercase tracking-wide opacity-60">
            {tk('survey.title')}
          </p>
          <p className="mt-1 font-body text-sm opacity-70">{tk('survey.hint')}</p>
        </div>

        <Card shadow="lg" padding="md" tone={badQuestion === q.id ? 'accent' : 'paper'}>
          <CardBody className="space-y-6">
            <div className="space-y-2">
              <h1 className="font-head text-xl font-bold leading-snug md:text-2xl">{copy.q}</h1>
              <div className="flex gap-2">
                {!q.required && <Badge tone="muted">{tk('survey.optional')}</Badge>}
                {q.type === 'multi_select' && <Badge tone="muted">{tk('survey.multiHint')}</Badge>}
              </div>
            </div>

            {q.type === 'single_select' && (
              <RadioGroup
                value={typeof answer === 'number' ? String(answer) : ''}
                onValueChange={(v) => set(Number(v))}
                disabled={pending}
              >
                {copy.options!.map((option, i) => (
                  <RadioCard key={i} value={String(i)} label={option} index={LETTERS[i]} disabled={pending} />
                ))}
              </RadioGroup>
            )}

            {q.type === 'multi_select' && (
              <div className="grid gap-3">
                {copy.options!.map((option, i) => {
                  const checked = Array.isArray(answer) && answer.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleMulti(i)}
                      disabled={pending}
                      aria-pressed={checked}
                      className={[
                        'qai-lift flex w-full items-center gap-4 border-brutal border-line p-4 text-left',
                        checked ? 'bg-accent text-accent-fg' : 'bg-paper',
                      ].join(' ')}
                    >
                      <span
                        aria-hidden
                        className={[
                          'flex h-8 w-8 shrink-0 items-center justify-center border-brutal border-line font-head text-sm font-bold',
                          checked ? 'bg-ink text-paper' : '',
                        ].join(' ')}
                      >
                        {LETTERS[i]}
                      </span>
                      <span className="font-body text-base leading-snug">{option}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {q.type === 'open_text' && (
              <div className="space-y-2">
                <Textarea
                  rows={3}
                  value={typeof answer === 'string' ? answer : ''}
                  onChange={(e) => set(e.target.value)}
                  placeholder={('placeholder' in copy ? copy.placeholder : '') as string}
                  disabled={pending}
                  maxLength={q.max_length}
                />
                {q.max_length !== undefined && (
                  <p className="text-right font-body text-xs opacity-50">
                    {tk('survey.charCount')
                      .replace('{n}', String(typeof answer === 'string' ? answer.length : 0))
                      .replace('{max}', String(q.max_length))}
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="space-y-2 border-brutal border-line bg-accent p-3">
                <p className="font-body text-sm">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={index === 0 || pending}
                onClick={() => setIndex((i) => i - 1)}
              >
                {tk('common.prev')}
              </Button>
              {isLast ? (
                <Button variant="primary" block disabled={!satisfied || pending} onClick={() => void submit()}>
                  {pending ? tk('survey.submitting') : tk('survey.submit')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  block
                  disabled={!satisfied || pending}
                  onClick={() => setIndex((i) => i + 1)}
                >
                  {tk('common.next')}
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
