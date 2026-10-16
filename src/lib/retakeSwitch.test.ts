import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '@/lib/i18n';
import { UI_STRINGS } from '@/config/ui-strings';
import { AdminAuthError } from '@/lib/adminApi';
import {
  nextSwitchValue,
  parseSwitchState,
  setSwitchFlow,
  switchConfirmKeys,
  switchStatus,
  type RetakeSwitchState,
} from '@/lib/retakeSwitch';
import { RetakeSwitchView, type RetakeSwitchViewProps } from '@/pages/admin/RetakeSwitchPanel';

/**
 * 后台的「重填开关」(重填第 5 步的准备,Viho 2026-10-16):对真实学员开不开放重填,存在数据库里,默认关闭。
 * 形状照抄 assessment-admin 的 `retake_switch` / `retake_switch_set` 回的东西。
 */
const CLOSED: RetakeSwitchState = { open: false, readable: true, recent: [] };
const OPENED: RetakeSwitchState = {
  open: true,
  readable: true,
  recent: [{ open: true, by: 'viho@example.com', at: '2026-10-17T02:00:00+00:00' }],
};
const CLOSED_AGAIN: RetakeSwitchState = {
  open: false,
  readable: true,
  recent: [
    { open: false, by: 'ops@example.com', at: '2026-10-17T03:30:00+00:00' },
    { open: true, by: 'viho@example.com', at: '2026-10-17T02:00:00+00:00' },
  ],
};
const UNREADABLE: RetakeSwitchState = { open: false, readable: false, recent: [] };

describe('parseSwitchState —— the server\'s answer, read the same way the server reads the table', () => {
  it('the three real shapes pass through', () => {
    for (const s of [CLOSED, OPENED, CLOSED_AGAIN, UNREADABLE]) expect(parseSwitchState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('only a boolean true counts as open — and never while unreadable', () => {
    expect(parseSwitchState({ open: 'true', readable: true, recent: [] }).open).toBe(false);
    expect(parseSwitchState({ open: 1, readable: true, recent: [] }).open).toBe(false);
    expect(parseSwitchState({ open: true, readable: false, recent: [] })).toEqual(UNREADABLE);
  });

  it('anything else (an older server, an error page, null) → unreadable and closed', () => {
    for (const raw of [null, undefined, 'ok', 42, [], {}, { open: true }, { readable: true }]) {
      expect(parseSwitchState(raw), JSON.stringify(raw)).toEqual(UNREADABLE);
    }
  });

  it('keeps only well-formed history lines', () => {
    const s = parseSwitchState({
      open: false,
      readable: true,
      recent: [{ open: false, by: 'a@x', at: '2026-10-17T03:00:00Z' }, { open: 'no', by: 'b@x', at: 'x' }, null, { open: true, by: 5, at: 'y' }],
    });
    expect(s.recent).toEqual([{ open: false, by: 'a@x', at: '2026-10-17T03:00:00Z' }]);
  });
});

describe('switchStatus / nextSwitchValue —— what the panel says and what its one button does', () => {
  it('open, closed, unreadable; a panel that could not load at all is unreadable', () => {
    expect(switchStatus(OPENED)).toBe('open');
    expect(switchStatus(CLOSED)).toBe('closed');
    expect(switchStatus(CLOSED_AGAIN)).toBe('closed');
    expect(switchStatus(UNREADABLE)).toBe('unreadable');
    expect(switchStatus(null)).toBe('unreadable');
  });

  it('the button always offers the other state — and when the state is unknown, it offers to CLOSE (the safe one)', () => {
    expect(nextSwitchValue('open')).toBe(false);
    expect(nextSwitchValue('closed')).toBe(true);
    expect(nextSwitchValue('unreadable')).toBe(false);
  });

  it('the confirm dialog says which way it goes, and its button names the action', () => {
    const on = switchConfirmKeys(true);
    const off = switchConfirmKeys(false);
    expect(on.confirmLabel).toBe('admin.retakeSwitch.turnOn');
    expect(off.confirmLabel).toBe('admin.retakeSwitch.turnOff');
    expect(on.title).not.toBe(off.title);
    expect(on.description).not.toBe(off.description);
    // 关闭的那一句要说清楚:做到一半的能做完或放弃(中文那一句由 i18n 对齐检查管着两种语言都有)
    expect(UI_STRINGS[off.description].en.toLowerCase()).toContain('finish');
    expect(UI_STRINGS[off.description].en.toLowerCase()).toContain('discard');
  });
});

describe('setSwitchFlow —— ask first, then send exactly the value the dialog asked about', () => {
  const confirmFor = (next: boolean) => ({ title: `t${next}`, description: 'd', confirmLabel: 'c' });

  it('cancel → nothing is sent', async () => {
    const request = vi.fn();
    const out = await setSwitchFlow({ ask: async () => false, confirm: confirmFor(true), next: true, request });
    expect(out).toEqual({ kind: 'cancelled' });
    expect(request).not.toHaveBeenCalled();
  });

  it('confirm → one request with the explicit value (not a toggle); the answer becomes the new state', async () => {
    const asked: unknown[] = [];
    const request = vi.fn(async () => OPENED);
    const out = await setSwitchFlow({
      ask: async (o) => {
        asked.push(o);
        return true;
      },
      confirm: confirmFor(true),
      next: true,
      request,
    });
    expect(asked).toEqual([confirmFor(true)]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(true);
    expect(out).toEqual({ kind: 'done', state: OPENED });

    const request2 = vi.fn(async () => CLOSED_AGAIN);
    expect(await setSwitchFlow({ ask: async () => true, confirm: confirmFor(false), next: false, request: request2 })).toEqual({
      kind: 'done',
      state: CLOSED_AGAIN,
    });
    expect(request2).toHaveBeenCalledWith(false);
  });

  it('the request is sent only after the dialog answered', async () => {
    const order: string[] = [];
    await setSwitchFlow({
      ask: async () => {
        order.push('ask');
        return true;
      },
      confirm: confirmFor(false),
      next: false,
      request: async () => {
        order.push('request');
        return CLOSED;
      },
    });
    expect(order).toEqual(['ask', 'request']);
  });

  it('signed out / not an admin → handed to the layout; any other failure → the message, state unknown', async () => {
    const run = (err: unknown) => setSwitchFlow({ ask: async () => true, confirm: confirmFor(false), next: false, request: async () => Promise.reject(err) });
    expect(await run(new AdminAuthError(401))).toEqual({ kind: 'authLost', forbidden: false });
    expect(await run(new AdminAuthError(403))).toEqual({ kind: 'authLost', forbidden: true });
    expect(await run(new Error('internal_error (query_failed 42501)'))).toEqual({ kind: 'failed', message: 'internal_error (query_failed 42501)' });
  });
});

describe('RetakeSwitchView', () => {
  const t = (k: keyof typeof UI_STRINGS) => UI_STRINGS[k].zh;
  const base: RetakeSwitchViewProps = {
    state: CLOSED,
    loading: false,
    busy: false,
    notice: null,
    onSet: () => {},
    onReload: () => {},
    onClose: () => {},
  };
  const render = (over: Partial<RetakeSwitchViewProps> = {}) =>
    renderToStaticMarkup(createElement(LocaleProvider, null, createElement(RetakeSwitchView, { ...base, ...over })));

  it('closed (the state after this step ships): says so, and offers to open', () => {
    const html = render();
    expect(html).toContain(t('admin.retakeSwitch.status.closed'));
    expect(html).toContain(t('admin.retakeSwitch.turnOn'));
    expect(html).not.toContain(t('admin.retakeSwitch.turnOff'));
    expect(html).toContain(t('admin.retakeSwitch.history.empty'));
  });

  it('always says what closing does to a retake in progress, and that the test cohort is not affected', () => {
    for (const state of [CLOSED, OPENED, UNREADABLE]) expect(render({ state })).toContain(t('admin.retakeSwitch.scope'));
  });

  it('open: says so, and offers to close', () => {
    const html = render({ state: OPENED });
    expect(html).toContain(t('admin.retakeSwitch.status.open'));
    expect(html).toContain(t('admin.retakeSwitch.turnOff'));
    expect(html).not.toContain(t('admin.retakeSwitch.turnOn'));
  });

  it('unreadable (or the panel could not load): says students are treated as closed, and offers only to close', () => {
    for (const state of [UNREADABLE, null]) {
      const html = render({ state });
      expect(html).toContain(t('admin.retakeSwitch.status.unreadable'));
      expect(html).toContain(t('admin.retakeSwitch.turnOff'));
      expect(html).not.toContain(t('admin.retakeSwitch.turnOn'));
    }
  });

  it('while loading: no switch button at all (nothing to press before we know the state)', () => {
    const html = render({ state: null, loading: true });
    expect(html).toContain(t('common.loading'));
    expect(html).not.toContain(t('admin.retakeSwitch.turnOn'));
    expect(html).not.toContain(t('admin.retakeSwitch.turnOff'));
  });

  it('the history: who, when (Malaysia time), which way — newest first, as the server sent it', () => {
    const html = render({ state: CLOSED_AGAIN });
    expect(html).toContain('ops@example.com');
    expect(html).toContain('viho@example.com');
    expect(html.indexOf('ops@example.com')).toBeLessThan(html.indexOf('viho@example.com'));
    expect(html).toContain(t('admin.retakeSwitch.history.on'));
    expect(html).toContain(t('admin.retakeSwitch.history.off'));
    // 03:30Z = 马来西亚 11:30
    expect(html).toContain('11:30');
    expect(html).not.toContain(t('admin.retakeSwitch.history.empty'));
  });

  it('busy: the switch button shows it is waiting for the server (the Button busy state, not a grey disabled)', () => {
    expect(render({ busy: true })).toContain('aria-busy="true"');
    expect(render({ busy: false })).not.toContain('aria-busy');
  });

  it('a notice is shown as a status line', () => {
    expect(render({ notice: 'internal_error (query_failed 42501)' })).toContain('internal_error (query_failed 42501)');
  });
});
