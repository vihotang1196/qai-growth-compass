/**
 * 校准脚本的 `--attempt=latest | first | all`(重填第 4 步,docs/retake-design.md 第 3 节「校准脚本」)—— 纯函数,没有 IO。
 *
 * 一个人重填之后有几份已出分的答题记录。校准要说清用的是哪一份:
 *   latest  默认。每人最新完成的一份 —— 与看板、报告基准线同一个定义(视图 `assessment_latest_results`)
 *   first   每人的第一份(attempt_no = 1)—— 第一次的样子,对校准有独立的价值
 *   all     每一份(重填过的人算多次)—— 只在比较前后时用
 *
 * 【范围要说出来】与 `--scope` 一样(判断标准 15):每次输出的开头都打印用的是哪一种。
 * 【忘了加过滤会被拦】`assertAttemptChosen`:查询里碰了 `assessment_results` 却没有 `attemptWhere` 的标记 → 拒绝执行。
 * 重填之前四个脚本都是直接 join 结果表、不分第几份 —— 今天的真实数据每人一份所以看不出来,开放重填之后就会把重填的人算两次。
 */
export type AttemptChoice = 'latest' | 'first' | 'all';

export const DEFAULT_ATTEMPT: AttemptChoice = 'latest';

/** 不是 `--attempt=` 开头 → null(交给别的参数);是但值不认识 → 抛 */
export function parseAttemptArg(arg: string): AttemptChoice | null {
  if (!arg.startsWith('--attempt=')) return null;
  const v = arg.slice('--attempt='.length);
  if (v === 'latest' || v === 'first' || v === 'all') return v;
  throw new Error(`--attempt 只认 latest | first | all,收到 ${JSON.stringify(v)}`);
}

/** 标记注释:`assertAttemptChosen` 只认这个精确的写法(带冒号与取值),所以字符串里、别的注释里出现的不算 */
const MARK = /\/\*attempt:(latest|first|all)\*\//;

/** 给 where 用的片段,表别名 `s` = assessment_sessions。带一个标记注释,`assertAttemptChosen` 认它 */
export function attemptWhere(choice: AttemptChoice): string {
  if (choice === 'latest') return '/*attempt:latest*/ s.id in (select l.session_id from assessment_latest_results l)';
  if (choice === 'first') return '/*attempt:first*/ s.attempt_no = 1';
  return '/*attempt:all*/ true';
}

export function describeAttempt(choice: AttemptChoice): string {
  if (choice === 'latest') return '每人最新完成的一份(默认;与看板、报告基准线同一个定义:视图 assessment_latest_results)';
  if (choice === 'first') return '每人的第一份(attempt_no = 1)';
  return '每一份(--attempt=all:重填过的人算多次,只在比较前后时用)';
}

/** 样本的单位:latest / first 每人一份 → 人;all → 份 */
export function sampleUnit(choice: AttemptChoice): string {
  return choice === 'all' ? '份' : '人';
}

/** 查询碰了结果表却没说取哪一份 → 拒绝(见文件头) */
export function assertAttemptChosen(sql: string): void {
  if (/\bassessment_results\b/.test(sql) && !MARK.test(sql)) {
    throw new Error('查询里取了 assessment_results 却没有说取哪一份 —— 在 where 里加 attemptWhere(args.attempt)');
  }
}
