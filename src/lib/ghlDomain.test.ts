import { describe, expect, it } from 'vitest';
import config from '@/config/assessment-config.json';
import { checkDomain, checkFields, type FieldSpec } from './ghlDomain';

describe('checkDomain — enum arrays', () => {
  const tiers = ['manual', 'spot', 'semi_auto', 'systemic', 'flywheel'];

  it('accepts a member, rejects a non-member', () => {
    expect(checkDomain('systemic', tiers).ok).toBe(true);
    const bad = checkDomain('legendary', tiers);
    expect(bad.ok).toBe(false);
    // reason 要点出实际值和允许值 —— 只说「不合法」的日志排查时没用
    expect((bad as { reason: string }).reason).toContain('legendary');
  });

  it('rejects a number where an enum string is expected', () => {
    expect(checkDomain(3, tiers).ok).toBe(false);
  });
});

describe('checkDomain — range strings (the shape a plain includes() would break on)', () => {
  it('accepts values inside 0.0-5.0 including both ends', () => {
    for (const v of [0, 0.1, 2.8, 4.0, 5]) {
      expect(checkDomain(v, '0.0-5.0'), `${v}`).toEqual({ ok: true });
    }
  });

  it('rejects values outside the range', () => {
    expect(checkDomain(-0.1, '0.0-5.0').ok).toBe(false);
    expect(checkDomain(5.1, '0.0-5.0').ok).toBe(false);
  });

  it('rejects non-numbers and non-finite numbers', () => {
    // "4.0" 是字符串 —— GHL 的 number 字段收字符串会静默存成 0 或报错,
    // 取决于它那边的实现。在这里就拦住
    expect(checkDomain('4.0', '0.0-5.0').ok).toBe(false);
    expect(checkDomain(NaN, '0.0-5.0').ok).toBe(false);
    expect(checkDomain(Infinity, '0.0-5.0').ok).toBe(false);
  });

  it('a malformed range domain fails loudly instead of skipping', () => {
    // domain 本身打错(config 错误)时必须报 —— 静默通过等于这个字段没有校验
    const bad = checkDomain(3, '0.0—5.0'); // em dash, not a hyphen
    expect(bad.ok).toBe(false);
    expect((bad as { reason: string }).reason).toContain('malformed');
  });
});

describe('checkDomain — null domain (free text)', () => {
  it('accepts anything when there is no max_length', () => {
    expect(checkDomain('any text at all', null).ok).toBe(true);
  });

  it('rejects over-length instead of truncating', () => {
    // 截断是静默丢数据。S5 的 goal_90d 是销售最好用的一句话,截半句比报错更糟
    expect(checkDomain('x'.repeat(201), null, 200).ok).toBe(false);
    expect(checkDomain('x'.repeat(200), null, 200).ok).toBe(true);
  });
});

describe('checkFields', () => {
  const specs: FieldSpec[] = [
    { key: 'qai_assessment_total', domain: '0.0-5.0' },
    { key: 'qai_assessment_tier', domain: ['manual', 'flywheel'] },
    { key: 'qai_assessment_goal_90d', domain: null, max_length: 200 },
  ];

  it('passes a clean payload', () => {
    expect(
      checkFields({ qai_assessment_total: 4.0, qai_assessment_tier: 'flywheel' }, specs),
    ).toEqual([]);
  });

  it('reports every failure, not just the first', () => {
    const failures = checkFields(
      { qai_assessment_total: 9.9, qai_assessment_tier: 'nope' },
      specs,
    );
    expect(failures.map((f) => f.key).sort()).toEqual([
      'qai_assessment_tier',
      'qai_assessment_total',
    ]);
  });

  it('rejects an undeclared key', () => {
    // 打错的 key 写进 GHL 会创建一个无人知晓的自定义字段,
    // 而本该填的那个字段永远是空的
    const failures = checkFields({ qai_assessment_totl: 4.0 }, specs);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain('not declared');
  });

  it('a partial payload is fine — missing keys are not failures', () => {
    // report_url 要等 PDF 好了才有值,分阶段写回是正常的
    expect(checkFields({ qai_assessment_tier: 'manual' }, specs)).toEqual([]);
  });
});

/**
 * 用真实 config 的 spec 跑一遍：一个合法的结果 payload 必须全过。
 * 这条锁住的是「代码与 config 对齐」，而不是 checkDomain 本身。
 */
describe('a real result payload passes the real config specs', () => {
  const specs = config.ghl_writeback.custom_fields as unknown as FieldSpec[];

  it('accepts a plausible completed result', () => {
    expect(
      checkFields(
        {
          qai_assessment_status: 'completed',
          qai_assessment_total: 4.0,
          qai_assessment_tier: 'systemic',
          qai_assessment_weakest_1: 'goal',
          qai_assessment_weakest_2: 'traffic',
          qai_assessment_priority: 'capture',
          qai_assessment_consult_interest: 'asap',
        },
        specs,
      ),
    ).toEqual([]);
  });

  it('the total field really is a range domain in config, not an enum', () => {
    // 这一条是给未来的人看的:如果有人把 total 的 domain 改成数组,
    // checkDomain 会开始要求字符串,而总分是数字 —— 立刻红在这里
    const total = specs.find((s) => s.key === 'qai_assessment_total')!;
    expect(typeof total.domain).toBe('string');
    expect(total.domain).toBe('0.0-5.0');
  });
});
