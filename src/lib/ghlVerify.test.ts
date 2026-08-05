import { describe, expect, it } from 'vitest';
import { classifyGhlError, parseFieldMap, verifyWrittenFields } from './ghlVerify';
import { CLASSIFY_CASES, FIELD_MAP, RAW_FIELD_RESPONSE } from './ghlVerify.cases';

describe('parseFieldMap', () => {
  it('builds key→id, stripping the contact. prefix', () => {
    expect(parseFieldMap(RAW_FIELD_RESPONSE)).toEqual(FIELD_MAP);
  });

  it('skips entries without an id or a derivable key', () => {
    const raw = { customFields: [{ name: 'no key or id' }, { id: 'x' }] };
    expect(parseFieldMap(raw)).toEqual({});
  });

  it('tolerates a missing customFields array', () => {
    expect(parseFieldMap({})).toEqual({});
    expect(parseFieldMap(null)).toEqual({});
  });

  it('accepts a bare key without a model prefix', () => {
    const raw = { customFields: [{ id: 'a', key: 'qai_assessment_tier' }] };
    expect(parseFieldMap(raw)).toEqual({ qai_assessment_tier: 'a' });
  });
});

describe('verifyWrittenFields', () => {
  const response = [
    { id: 'RjLthowcJvQPP6zSyeEN', value: 0.6 },
    { id: 'CgO6Jzy2o6uIizRGNiol', value: 'manual' },
    { id: 'gwV3oUv28CSgn0j7mGHX', value: 'goal' },
  ];

  it('all fields present with matching values → ok', () => {
    const r = verifyWrittenFields(
      { qai_assessment_total: 0.6, qai_assessment_tier: 'manual', qai_assessment_weakest_1: 'goal' },
      FIELD_MAP,
      response,
    );
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('number echoed as number still matches (total = 0.6)', () => {
    // 关键:total 发出去是 number,回来也是 number,不能因为类型而误判 mismatch
    const r = verifyWrittenFields({ qai_assessment_total: 0.6 }, FIELD_MAP, response);
    expect(r.ok).toBe(true);
  });

  it('number echoed as string still matches', () => {
    const r = verifyWrittenFields({ qai_assessment_total: 0.6 }, FIELD_MAP, [
      { id: 'RjLthowcJvQPP6zSyeEN', value: '0.6' },
    ]);
    expect(r.ok).toBe(true);
  });

  it('a key not in the field map is flagged with an actionable reason', () => {
    const r = verifyWrittenFields({ qai_assessment_priority: 'goal' }, FIELD_MAP, response);
    expect(r.ok).toBe(false);
    expect(r.missing[0].key).toBe('qai_assessment_priority');
    expect(r.missing[0].reason).toMatch(/field map/);
  });

  it('a field dropped by GHL (id not echoed) is flagged', () => {
    // 这正是上一轮的静默失败:字段不存在,响应里就没有那个 id
    const r = verifyWrittenFields({ qai_assessment_tier: 'manual' }, FIELD_MAP, [
      { id: 'RjLthowcJvQPP6zSyeEN', value: 0.6 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.missing[0].reason).toMatch(/not echoed/);
  });

  it('a value mismatch is flagged and names both values', () => {
    const r = verifyWrittenFields({ qai_assessment_tier: 'manual' }, FIELD_MAP, [
      { id: 'CgO6Jzy2o6uIizRGNiol', value: 'flywheel' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.missing[0].reason).toMatch(/mismatch/);
    expect(r.missing[0].reason).toContain('flywheel');
  });

  it('lists every missing field, not just the first (D9)', () => {
    const r = verifyWrittenFields(
      { qai_assessment_tier: 'manual', qai_assessment_weakest_1: 'goal' },
      FIELD_MAP,
      [], // nothing echoed
    );
    expect(r.missing.map((m) => m.key).sort()).toEqual([
      'qai_assessment_tier',
      'qai_assessment_weakest_1',
    ]);
  });
});

describe('classifyGhlError', () => {
  for (const c of CLASSIFY_CASES) {
    it(`${c.status} → ${c.expect}`, () => {
      expect(classifyGhlError(c.status)).toBe(c.expect);
    });
  }
});
