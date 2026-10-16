import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ATTEMPT,
  assertAttemptChosen,
  attemptWhere,
  describeAttempt,
  parseAttemptArg,
  sampleUnit,
} from '../../scripts/calibration/attempt.ts';

/**
 * 校准脚本的 `--attempt`(重填第 4 步)。脚本本身要连生产库才跑得起来,这里测的是它们共用的那一段:
 * 参数、where 片段、「忘了说取哪一份」的拦截。生产上的前后对比记在 PROGRESS。
 */
describe('parseAttemptArg', () => {
  it('the default is the latest finished attempt — the same definition the dashboard and the report baseline use', () => {
    expect(DEFAULT_ATTEMPT).toBe('latest');
  });

  it('reads the three choices', () => {
    expect(parseAttemptArg('--attempt=latest')).toBe('latest');
    expect(parseAttemptArg('--attempt=first')).toBe('first');
    expect(parseAttemptArg('--attempt=all')).toBe('all');
  });

  it('leaves other arguments alone', () => {
    expect(parseAttemptArg('--scope=test')).toBeNull();
    expect(parseAttemptArg('--json')).toBeNull();
  });

  it('a wrong value is an error, never a silent fallback to some default', () => {
    for (const bad of ['--attempt=', '--attempt=last', '--attempt=1', '--attempt=LATEST']) {
      expect(() => parseAttemptArg(bad), bad).toThrow();
    }
  });
});

describe('attemptWhere —— the SQL each choice adds (table alias s = assessment_sessions)', () => {
  it('latest reads the view, so there is still only one definition of "latest"', () => {
    expect(attemptWhere('latest')).toMatch(/s\.id in \(select \w+\.session_id from assessment_latest_results \w+\)/);
  });

  it('first is attempt 1', () => {
    expect(attemptWhere('first')).toMatch(/s\.attempt_no = 1\b/);
  });

  it('all adds no restriction', () => {
    expect(attemptWhere('all')).not.toMatch(/attempt_no|latest_results/);
  });

  it('each one carries the marker the guard looks for, and the three differ', () => {
    const all = (['latest', 'first', 'all'] as const).map(attemptWhere);
    for (const w of all) expect(() => assertAttemptChosen(`select 1 from assessment_results r where ${w}`)).not.toThrow();
    expect(new Set(all).size).toBe(3);
  });
});

describe('assertAttemptChosen —— a query on results that forgot to choose is refused', () => {
  it('results joined without a choice → refused (the four scripts before this step looked exactly like this)', () => {
    const before = `select r.total from assessment_results r join assessment_sessions s on s.id = r.session_id
      join assessment_entitlements e on e.id = s.entitlement_id left join assessment_cohorts c on c.id = e.cohort_id
      where coalesce(c.is_test, false) = false`;
    expect(() => assertAttemptChosen(before)).toThrow();
  });

  it('a marker inside a string or a different comment does not count', () => {
    expect(() => assertAttemptChosen("select 'attempt:latest' from assessment_results r")).toThrow();
    expect(() => assertAttemptChosen('select 1 from assessment_results r /* attempt */')).toThrow();
  });

  it('queries that do not touch results are not its business', () => {
    expect(() => assertAttemptChosen('select id from assessment_cohorts')).not.toThrow();
  });
});

describe('what the output header says', () => {
  it('names the choice (the header is printed on every run)', () => {
    expect(describeAttempt('latest')).toContain('assessment_latest_results');
    expect(describeAttempt('first')).toContain('attempt_no = 1');
    expect(describeAttempt('all')).toContain('--attempt=all');
    expect(new Set((['latest', 'first', 'all'] as const).map(describeAttempt)).size).toBe(3);
  });

  it('counts people for one-per-person choices and attempts for all', () => {
    expect(sampleUnit('latest')).toBe(sampleUnit('first'));
    expect(sampleUnit('all')).not.toBe(sampleUnit('latest'));
  });
});
