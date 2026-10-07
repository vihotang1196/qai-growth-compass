import { describe, expect, it, vi } from 'vitest';
import { afterReadyWrite, writeWithRetry } from '../../api/_lib/statusWrite';

/**
 * render-pdf 写 ready 那一步。
 *
 * 2026-10-07 之前:那一次 update 的结果根本没看 —— 写不进去照样回 200 ok,
 * 调用方(report-file、Admin 的「重新生成」)于是告诉人「好了」,而库里还是 rendering。
 * 现在:短间隔重试最多 3 次;仍失败就回失败,pdf-sweep 兜底重渲。
 */

/** supabase-js 返回的 error 是普通对象,不是 Error —— 用同一个形状 */
const DB_ERROR = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null };

function scriptedWrite(results: Array<'ok' | 'fail' | 'throw'>) {
  const calls: number[] = [];
  const write = () => {
    calls.push(calls.length + 1);
    const r = results[Math.min(calls.length - 1, results.length - 1)];
    if (r === 'throw') return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve({ error: r === 'ok' ? null : DB_ERROR });
  };
  return { write, calls };
}

describe('writeWithRetry (the ready write)', () => {
  // 一直写不进去:试满 3 次、中间睡 2 次,然后如实报失败
  it('retries a failing write up to 3 times, then reports the failure', async () => {
    const { write, calls } = scriptedWrite(['fail']);
    const sleep = vi.fn(async () => {});
    const out = await writeWithRetry(write, { attempts: 3, delayMs: 250, sleep });
    expect(out.ok).toBe(false);
    expect(out.attempts).toBe(3);
    expect(out.error).toEqual(DB_ERROR);
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  // 第二次写进去了 → 成功,不再继续试
  it('stops as soon as a retry succeeds', async () => {
    const { write, calls } = scriptedWrite(['fail', 'ok']);
    const out = await writeWithRetry(write, { attempts: 3, delayMs: 1, sleep: async () => {} });
    expect(out).toEqual({ ok: true, attempts: 2, error: null });
    expect(calls).toHaveLength(2);
  });

  // 第一次就成功:不睡
  it('does not sleep when the first write succeeds', async () => {
    const { write } = scriptedWrite(['ok']);
    const sleep = vi.fn(async () => {});
    const out = await writeWithRetry(write, { attempts: 3, delayMs: 250, sleep });
    expect(out).toEqual({ ok: true, attempts: 1, error: null });
    expect(sleep).not.toHaveBeenCalled();
  });

  // 写的那一下自己抛了(网络层)也算一次失败,照样重试
  it('treats a thrown write (network) as a failed attempt and retries it', async () => {
    const { write, calls } = scriptedWrite(['throw', 'ok']);
    const out = await writeWithRetry(write, { attempts: 3, delayMs: 1, sleep: async () => {} });
    expect(out.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe('afterReadyWrite (what the caller is told)', () => {
  const success = { ok: true, path: 'x/zh.pdf' };

  // 写 ready 失败 → 回失败,**绝不**是 200 ok
  it('a failed ready write is a 500 status_write_failed, never 200', () => {
    const r = afterReadyWrite({ ok: false, attempts: 3, error: DB_ERROR }, success);
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('status_write_failed');
    expect(r.body.ok).not.toBe(true);
    // 回给调用方的说明里不带数据库原文(那只进日志)
    expect(JSON.stringify(r.body)).not.toContain('statement timeout');
  });

  it('a successful ready write passes the success payload through as 200', () => {
    expect(afterReadyWrite({ ok: true, attempts: 1, error: null }, success)).toEqual({ status: 200, body: success });
  });
});
