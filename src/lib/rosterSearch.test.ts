import { describe, expect, it } from 'vitest';
import { rosterMatches } from '@/lib/rosterSearch';

/**
 * 名单搜索(Viho 2026-10-14):按姓名、电话、邮箱查,部分匹配、不分大小写。
 * 纯函数;搜索词只在浏览器内存里用,不发请求、不进 URL、不进存储(见 Roster.tsx)。
 */
const row = (over: Partial<Parameters<typeof rosterMatches>[0]> = {}) => ({
  name: 'Tan Ah Kow',
  phone_e164: '+60123456789',
  phone_raw: '012-345 6789',
  email_lower: 'ahkow.tan@example.com',
  ...over,
});

describe('rosterMatches', () => {
  it('empty or whitespace-only query matches everyone (the search box is off)', () => {
    expect(rosterMatches(row(), '')).toBe(true);
    expect(rosterMatches(row(), '   ')).toBe(true);
  });

  it('name: partial and case-insensitive; extra spaces in the query do not matter', () => {
    expect(rosterMatches(row(), 'TAN')).toBe(true);
    expect(rosterMatches(row(), 'ah kow')).toBe(true);
    expect(rosterMatches(row(), '  ah    KOW ')).toBe(true);
    expect(rosterMatches(row(), 'lim')).toBe(false);
  });

  it('name: CJK partial match, and full-width letters are folded (NFKC)', () => {
    // 「陈小明」/「小明」—— 运行时拼出来:src 里的字符串字面量不许有中文(lint:cjk 看的是解码后的值,转义也算)
    const cjk = (...cp: number[]) => String.fromCodePoint(...cp);
    expect(rosterMatches(row({ name: cjk(0x9648, 0x5c0f, 0x660e) }), cjk(0x5c0f, 0x660e))).toBe(true);
    expect(rosterMatches(row(), 'ＴＡＮ')).toBe(true); // full-width "TAN"
  });

  it('email: partial and case-insensitive', () => {
    expect(rosterMatches(row(), 'EXAMPLE.COM')).toBe(true);
    expect(rosterMatches(row(), 'ahkow.t')).toBe(true);
    expect(rosterMatches(row(), 'gmail')).toBe(false);
  });

  it('phone: matches however it is typed (local 0, +60, spaces, dashes, brackets)', () => {
    for (const q of ['0123456789', '012-345 6789', '+60 12-345 6789', '(012) 3456789', '6789', '345 67']) {
      expect(rosterMatches(row(), q), q).toBe(true);
    }
    expect(rosterMatches(row(), '0199999')).toBe(false);
  });

  it('phone: the raw value counts too (a number that could not be parsed has no E.164)', () => {
    expect(rosterMatches(row({ phone_e164: null, phone_raw: '+65 8123 4567' }), '8123-4567')).toBe(true);
  });

  it('digits inside a mixed query are not matched against phones ("ann2024" must not hit a phone ending 2024)', () => {
    expect(rosterMatches(row({ phone_e164: '+60122222024', phone_raw: null }), 'ann2024')).toBe(false);
  });

  it('missing fields are fine', () => {
    expect(rosterMatches({ name: null, phone_e164: null, phone_raw: null, email_lower: null }, 'x')).toBe(false);
    expect(rosterMatches({ name: null, phone_e164: null, phone_raw: null, email_lower: null }, '')).toBe(true);
  });
});
