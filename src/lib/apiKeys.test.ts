import { describe, expect, it } from 'vitest';
import {
  classifySupabaseKey,
  pickPublishableKey,
  pickSecretKey,
  supabaseKeyHeaders,
} from '../../api/_lib/apiKeys';

/**
 * 这一组守的是一件事:**新 key 不能进 `Authorization: Bearer`,legacy 必须进**。
 *
 * 判错的失败形态是鉴权被拒,而鉴权被拒的错误信息从来不会说「你把 key 放错头了」——
 * 所以它必须有断言,不能靠「记得官方那条规则」。
 */

/** 形状对就够,值是编的 —— 这几个测试不需要真 key */
const LEGACY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.fake_sig';
const PUBLISHABLE = 'sb_publishable_AbCdEf0123456789';
const SECRET = 'sb_secret_ZyXwVu9876543210';

describe('classifySupabaseKey', () => {
  it('recognises both new-format prefixes', () => {
    expect(classifySupabaseKey(PUBLISHABLE)).toBe('new_format');
    expect(classifySupabaseKey(SECRET)).toBe('new_format');
  });

  it('treats a legacy JWT as legacy', () => {
    expect(classifySupabaseKey(LEGACY)).toBe('legacy_jwt');
  });

  it('treats anything unrecognised as legacy — the conservative direction', () => {
    /**
     * 认不出来时当 legacy:多发一个 Authorization 头不会让 legacy 失败,
     * 而少发一个会让 legacy 直接被拒。所以未知值要往「多发」那边倒。
     */
    for (const odd of ['', 'garbage', 'sb_something_else', 'Bearer eyJ']) {
      expect(classifySupabaseKey(odd), odd).toBe('legacy_jwt');
    }
  });
});

describe('supabaseKeyHeaders', () => {
  it('a legacy key goes in both apikey and Authorization', () => {
    expect(supabaseKeyHeaders(LEGACY)).toEqual({
      apikey: LEGACY,
      Authorization: `Bearer ${LEGACY}`,
    });
  });

  it('a new-format key goes ONLY in apikey', () => {
    // 官方:新 key 不是 JWT,放进 Bearer 会被拒
    expect(supabaseKeyHeaders(PUBLISHABLE)).toEqual({ apikey: PUBLISHABLE });
    expect(supabaseKeyHeaders(SECRET)).toEqual({ apikey: SECRET });
  });

  it('never puts a new-format key anywhere near Authorization', () => {
    // 单独立一条:这是整个模块存在的理由,不与上面合并
    for (const key of [PUBLISHABLE, SECRET]) {
      expect(Object.keys(supabaseKeyHeaders(key))).not.toContain('Authorization');
      expect(JSON.stringify(supabaseKeyHeaders(key))).not.toContain('Bearer');
    }
  });
});

describe('pickSecretKey reads the JSON dictionary the platform injects', () => {
  const json = JSON.stringify({ default: SECRET, other: 'sb_secret_other000' });

  it('takes the named key out of SUPABASE_SECRET_KEYS', () => {
    expect(pickSecretKey(json, LEGACY)).toBe(SECRET);
    expect(pickSecretKey(json, LEGACY, 'other')).toBe('sb_secret_other000');
  });

  it('prefers the new key over legacy — Disable makes legacy stop working', () => {
    // 顺序不能反:按下 Disable 之后 legacy 就不认了
    expect(pickSecretKey(json, LEGACY)).not.toBe(LEGACY);
  });

  it('falls back to legacy before the new var exists', () => {
    // 部署代码那一刻新变量还没配 —— 那时必须照旧能跑
    expect(pickSecretKey(undefined, LEGACY)).toBe(LEGACY);
    expect(pickSecretKey('', LEGACY)).toBe(LEGACY);
  });

  it('falls back to legacy when the JSON is malformed instead of throwing', () => {
    /**
     * 平台哪天改了这个变量的形状,不该因此整个函数起不来 ——
     * 那会把一次格式变化变成全站故障。
     */
    for (const bad of ['not json', '[]', 'null', '"a string"', '{"default":123}', '{}']) {
      expect(pickSecretKey(bad, LEGACY), bad).toBe(LEGACY);
    }
  });

  it('returns null when neither generation is available', () => {
    // 由调用方抛带上下文的错误 —— 「哪个变量缺了」的诊断属于调用点
    expect(pickSecretKey(undefined, undefined)).toBeNull();
    expect(pickSecretKey('{}', '')).toBeNull();
  });

  it('a missing name does not silently fall through to another key', () => {
    // 取 'nope' 却拿到 default,会让「按名字分服务用不同 key」这件事无声失效
    expect(pickSecretKey(json, null, 'nope')).toBeNull();
  });
});

describe('pickPublishableKey', () => {
  it('prefers the publishable key, falls back to anon', () => {
    expect(pickPublishableKey(PUBLISHABLE, LEGACY)).toBe(PUBLISHABLE);
    expect(pickPublishableKey(undefined, LEGACY)).toBe(LEGACY);
    expect(pickPublishableKey('', LEGACY)).toBe(LEGACY);
    expect(pickPublishableKey(null, null)).toBeNull();
  });
});
