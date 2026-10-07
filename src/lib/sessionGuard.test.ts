import { describe, expect, it } from 'vitest';
import { guardSessionWrite } from '../../api/_lib/sessionGuard';
import { guardErrorOf, routeForStatus } from './sessionFlow';

/**
 * 已完成的学员不能再写入;旧分页不能写进别人的 session。
 *
 * 2026-10-07 第三次彩排(第一遍):手机上一个旧的答题分页(第二次彩排留下的)
 * 在 cookie 已经换成第一次彩排那条之后被继续使用 —— 15 题、问卷、出分全部写进了
 * **第一次彩排那条已经完成的 session**,结果被改写、中文 PDF 被重渲。
 * 两个洞:①completed 的 session 照样接受写入;②页面不知道自己属于哪个 session,
 * 点下去的每一次都写进 cookie 当前那一个。
 */
const S = '79c721f5-af68-4df5-ad23-af16a55535e3';
const OTHER = '4a3d247c-a870-48af-968f-10f88d072cab';

describe('guardSessionWrite (server)', () => {
  // 正在答题 / 已到问卷,而且就是这个 session → 放行
  it('allows writes to an in_progress or survey session the page belongs to', () => {
    expect(guardSessionWrite({ id: S, status: 'in_progress' }, S)).toEqual({ ok: true });
    expect(guardSessionWrite({ id: S, status: 'survey' }, S)).toEqual({ ok: true });
  });

  // 已经完成 → already_completed,什么都不写
  it('refuses any write to a completed session (already_completed)', () => {
    expect(guardSessionWrite({ id: S, status: 'completed' }, S)).toEqual({ ok: false, error: 'already_completed' });
  });

  // 页面加载时属于另一个 session(旧分页 + cookie 换了人)→ session_changed,不管状态
  it('refuses a write from a page loaded for a different session (session_changed)', () => {
    expect(guardSessionWrite({ id: S, status: 'in_progress' }, OTHER)).toEqual({ ok: false, error: 'session_changed' });
    expect(guardSessionWrite({ id: S, status: 'completed' }, OTHER)).toEqual({ ok: false, error: 'session_changed' });
  });

  // 页面没带 session_id(这次之前加载的旧页面)→ 也当成 session_changed:它不知道自己属于谁
  it('treats a write without a page session id as session_changed', () => {
    expect(guardSessionWrite({ id: S, status: 'in_progress' }, undefined)).toEqual({ ok: false, error: 'session_changed' });
    expect(guardSessionWrite({ id: S, status: 'in_progress' }, '')).toEqual({ ok: false, error: 'session_changed' });
  });
});

describe('guardErrorOf (client)', () => {
  it('recognises the two guard errors on a 409', () => {
    expect(guardErrorOf(409, { error: 'already_completed' })).toBe('already_completed');
    expect(guardErrorOf(409, { error: 'session_changed' })).toBe('session_changed');
  });

  // 其余 409(没答满、没交问卷)不是守卫错误 —— 照旧走原来的分支
  it('leaves other 409s and other statuses alone', () => {
    expect(guardErrorOf(409, { error: 'incomplete' })).toBeNull();
    expect(guardErrorOf(400, { error: 'already_completed' })).toBeNull();
    expect(guardErrorOf(409, null)).toBeNull();
  });
});

describe('routeForStatus (client)', () => {
  // 加载时已经完成 → 报告页;其余各回各位
  it('sends a completed session to the report, the others to where they are', () => {
    expect(routeForStatus('completed', 'en')).toBe('/report?lang=en');
    expect(routeForStatus('survey', 'zh')).toBe('/survey?lang=zh');
    expect(routeForStatus('in_progress', 'zh')).toBe('/quiz?lang=zh');
  });
});
