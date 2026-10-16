import { describe, expect, it } from 'vitest';
import { attentionItems, parseCounts, renderMonitor, toMyt, type RetakeCounts } from '../../scripts/monitor/retakeReport.ts';

/**
 * `npm run monitor:retake`(重填第 5 步,开放前后看的那些数)。查询要连生产库,这里测的是它之后的那一段:
 * 什么算「需要看一眼」(退出码 1)、时间怎么写、输出里有没有混进个人信息。
 * 行的形状照抄 `supabase db query --linked` 回的(计数是数字,时间是 `2026-10-16 08:34:56.044825+00`)。
 */
const ZERO: Record<string, unknown> = {
  at: '2026-10-16 08:55:00.123456+00',
  retakes_in_db: 0,
  retakes_completed: 0,
  retakes_open: 0,
  stuck_24h: 0,
  oldest_open_started: null,
  people_retaken: 0,
  last_started: null,
  last_completed: null,
  opened_at: null,
  started_since_open: 0,
  completed_since_open: 0,
  results: 0,
  fields_unsynced: 0,
  fields_unsynced_30m: 0,
  fields_gave_up: 0,
  tags_unsynced: 0,
  tags_unsynced_30m: 0,
  tags_gave_up: 0,
  unsynced_superseded: 0,
  last_result: null,
  files: 0,
  pdf_ready: 0,
  pdf_failed: 0,
  pdf_exhausted: 0,
  pdf_stuck_30m: 0,
  card_errors: 0,
  first_completed: 99,
  other_scope_retakes: 2,
};
const counts = (over: Record<string, unknown> = {}): RetakeCounts => parseCounts({ ...ZERO, ...over });

describe('parseCounts', () => {
  it('reads the CLI row: numbers stay numbers, bigint-as-string becomes a number, timestamps stay strings or null', () => {
    const c = parseCounts({ ...ZERO, retakes_in_db: '3', first_completed: 99, last_started: '2026-10-17 02:00:00+00' });
    expect(c.retakes_in_db).toBe(3);
    expect(c.first_completed).toBe(99);
    expect(c.last_started).toBe('2026-10-17 02:00:00+00');
    expect(c.opened_at).toBeNull();
  });

  it('a missing or non-numeric count is an error, never a silent zero', () => {
    const { stuck_24h: _drop, ...missing } = ZERO;
    expect(() => parseCounts(missing)).toThrow();
    expect(() => parseCounts({ ...ZERO, pdf_failed: 'x' })).toThrow();
  });
});

describe('attentionItems —— what makes the command exit 1', () => {
  it('the baseline (nothing retaken yet) needs nothing', () => {
    expect(attentionItems(counts())).toEqual([]);
  });

  it('each of these on its own is flagged, with its count', () => {
    for (const id of [
      'stuck_24h',
      'fields_unsynced_30m',
      'tags_unsynced_30m',
      'fields_gave_up',
      'tags_gave_up',
      'pdf_failed',
      'pdf_exhausted',
      'pdf_stuck_30m',
      'card_errors',
    ] as const) {
      expect(attentionItems(counts({ [id]: 2 })), id).toEqual([{ id, n: 2 }]);
    }
  });

  it('things still in flight are not flagged: a retake in progress, a result synced less than 30 minutes ago, an older attempt superseded by a newer one', () => {
    expect(
      attentionItems(counts({ retakes_in_db: 3, retakes_open: 1, results: 2, fields_unsynced: 1, tags_unsynced: 1, unsynced_superseded: 4, files: 2, pdf_ready: 1 })),
    ).toEqual([]);
  });
});

describe('toMyt —— times are written in Malaysia time, with the UTC beside it', () => {
  it('converts the CLI timestamp shape', () => {
    expect(toMyt('2026-10-16 08:34:56.044825+00')).toBe('2026-10-16 16:34 MYT (08:34Z)');
    expect(toMyt('2026-10-16T23:10:00Z')).toBe('2026-10-17 07:10 MYT (23:10Z)');
  });

  it('null or junk → a dash, not "Invalid Date"', () => {
    expect(toMyt(null)).toBe('—');
    expect(toMyt('not a time')).toBe('—');
  });
});

describe('renderMonitor', () => {
  const render = (over: Partial<Parameters<typeof renderMonitor>[0]> = {}) =>
    renderMonitor({ scope: 'real', switchRows: [], counts: counts(), ghlClasses: [], ...over });

  it('prints every number it was given (spot check: the baseline counts and the reference line)', () => {
    const out = render({ counts: counts({ retakes_in_db: 7, retakes_completed: 5, retakes_open: 2, stuck_24h: 1, pdf_failed: 3 }) });
    for (const n of ['7', '5', '2', '1', '3', '99']) expect(out).toContain(n);
  });

  it('the switch: the newest change and its time, and whether "who" was recorded — never the email itself', () => {
    const out = render({
      switchRows: [
        { open: true, changed_at: '2026-10-17 02:00:00+00', who_recorded: true },
        { open: false, changed_at: '2026-10-17 01:00:00+00', who_recorded: true },
      ],
    });
    expect(out).toContain('2026-10-17 10:00 MYT');
    expect(out).toContain('2026-10-17 09:00 MYT');
    expect(out.indexOf('10:00 MYT')).toBeLessThan(out.indexOf('09:00 MYT'));
    expect(out).not.toMatch(/@/);
  });

  it('since-opening counts appear only once the switch has been opened', () => {
    const closed = render();
    const opened = render({ counts: counts({ opened_at: '2026-10-17 02:00:00+00', started_since_open: 4, completed_since_open: 1 }) });
    expect(opened).toContain('2026-10-17 10:00 MYT');
    expect(opened.length).toBeGreaterThan(closed.length);
  });

  it('GHL error classes are printed as counts per class; the error text never is', () => {
    const out = render({ counts: counts({ fields_unsynced: 2 }), ghlClasses: [{ kind: 'fields', klass: 'TRANSIENT', n: 2 }] });
    expect(out).toContain('TRANSIENT');
  });

  it('says which scope it counted, and ends with the verdict', () => {
    expect(render()).not.toBe(render({ scope: 'test' }));
    const flagged = render({ counts: counts({ pdf_failed: 1 }) });
    expect(flagged.trim().split('\n').pop()).toContain('pdf_failed');
  });

  it('no personal information in any output: no @, no phone-like digit runs', () => {
    const out = render({
      switchRows: [{ open: true, changed_at: '2026-10-17 02:00:00+00', who_recorded: true }],
      counts: counts({ retakes_in_db: 12, opened_at: '2026-10-17 02:00:00+00' }),
      ghlClasses: [{ kind: 'tags', klass: 'AUTH', n: 1 }],
    });
    expect(out).not.toMatch(/@/);
    expect(out).not.toMatch(/\+?\d{8,}/);
  });
});
