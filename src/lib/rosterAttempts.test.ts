import { describe, expect, it } from 'vitest';
import { attemptCell, historyLines, type RosterAttemptData } from '@/lib/rosterAttempts';

/**
 * 名单的「第几次」与「历次」(重填第 4 步)。形状照抄 assessment-admin roster 回的 `session` / `attempts`;
 * 编号与状态照抄 2026-10-16 生产上那条测试 entitlement(三份都完成)和「重填做到一半」的样子。
 */
type FileRow = NonNullable<RosterAttemptData['files']>[number];
const file = (lang: string, pdf_status: string, over: Partial<FileRow> = {}): FileRow => ({
  lang,
  pdf_status,
  pdf_path: pdf_status === 'ready' ? `x-${lang}.pdf` : null,
  pdf_attempts: 1,
  pdf_last_error: pdf_status === 'failed' ? 'boom' : null,
  share_card_error: null,
  ...over,
});
const done = (no: number, files: FileRow[] = [file('zh', 'ready')]): RosterAttemptData => ({
  id: `ses-${no}`,
  status: 'completed',
  attempt_no: no,
  completed_at: `2026-10-1${3 + no}T06:00:00+00:00`,
  created_at: `2026-10-1${3 + no}T05:59:00+00:00`,
  result: { total: no, tier: 'spot', weakest: ['traffic'] },
  files,
});
const open = (no: number, status = 'in_progress'): RosterAttemptData => ({
  id: `ses-${no}`,
  status,
  attempt_no: no,
  completed_at: null,
  created_at: '2026-10-16T06:40:54+00:00',
  result: null,
  files: [],
});

describe('attemptCell —— the "attempt" cell of a roster row', () => {
  it('today\'s data (one finished attempt): attempt 1, nothing to expand, no retake in progress', () => {
    expect(attemptCell(done(1), [done(1)])).toEqual({ shownNo: 1, count: 1, openNo: null });
  });

  it('three finished attempts (the test entitlement on 2026-10-16): attempt 3, three to expand', () => {
    expect(attemptCell(done(3), [done(3), done(2), done(1)])).toEqual({ shownNo: 3, count: 3, openNo: null });
  });

  it('a retake in progress: the row still shows the latest FINISHED one, and says which one is open', () => {
    expect(attemptCell(done(2), [open(3), done(2), done(1)])).toEqual({ shownNo: 2, count: 3, openNo: 3 });
    expect(attemptCell(done(1), [open(2, 'survey'), done(1)])).toEqual({ shownNo: 1, count: 2, openNo: 2 });
  });

  it('nothing finished yet: a dash — and the first attempt in progress is not "a retake in progress"', () => {
    expect(attemptCell(open(1), [open(1)])).toEqual({ shownNo: null, count: 1, openNo: null });
    expect(attemptCell(null, [])).toEqual({ shownNo: null, count: 0, openNo: null });
  });

  it('an older server without `attempts` (the minutes between deploying the function and the page): just the one session', () => {
    expect(attemptCell(done(1), undefined)).toEqual({ shownNo: 1, count: 1, openNo: null });
    expect(attemptCell({ ...done(1), attempt_no: undefined }, undefined)).toEqual({ shownNo: 1, count: 1, openNo: null });
    expect(attemptCell(open(1), undefined)).toEqual({ shownNo: null, count: 1, openNo: null });
    expect(attemptCell(null, undefined)).toEqual({ shownNo: null, count: 0, openNo: null });
  });
});

describe('historyLines —— the expanded list of every attempt', () => {
  it('fewer than two attempts → no list', () => {
    expect(historyLines(done(1), [done(1)])).toBeNull();
    expect(historyLines(open(1), [open(1)])).toBeNull();
    expect(historyLines(null, [])).toBeNull();
    expect(historyLines(done(1), undefined)).toBeNull();
  });

  it('newest first, whatever order the server sent; the shown one and the open one are marked', () => {
    const lines = historyLines(done(2), [done(1), open(3), done(2)])!;
    expect(lines.map((l) => [l.no, l.shown, l.open, l.canOpenReport])).toEqual([
      [3, false, true, false],
      [2, true, false, true],
      [1, false, false, true],
    ]);
    expect(lines.map((l) => l.attempt.id)).toEqual(['ses-3', 'ses-2', 'ses-1']);
  });

  it('file states per language for finished attempts; none for the open one', () => {
    const lines = historyLines(done(2), [open(3), done(2, [file('zh', 'ready'), file('en', 'failed')]), done(1)])!;
    expect(lines[0].states).toEqual([]);
    expect(lines[1].states.map((s) => [s.lang, s.availability])).toEqual([
      ['zh', 'ready'],
      ['en', 'failed'],
    ]);
  });

  it('the shown (latest) attempt may re-generate any language that is not ready — including one it never had', () => {
    const lines = historyLines(done(2, [file('zh', 'failed')]), [done(2, [file('zh', 'failed')]), done(1)])!;
    expect(lines[0].regen).toEqual(['zh', 'en']);
  });

  it('an earlier attempt may only re-generate files it already has — never the other language (Viho\'s decision 2)', () => {
    const older = done(1, [file('zh', 'failed')]);
    const lines = historyLines(done(2), [done(2), older])!;
    expect(lines[1].regen).toEqual(['zh']);
    // 全都好了:没有按钮
    expect(historyLines(done(2), [done(2), done(1)])![1].regen).toEqual([]);
    // 正在渲的那一份照样给(与主行一致:卡住的 pending 要有出路)
    expect(historyLines(done(2), [done(2), done(1, [file('zh', 'pending', { pdf_attempts: 0 })])])![1].regen).toEqual(['zh']);
  });

  it('the open attempt has no report and nothing to re-generate', () => {
    const lines = historyLines(done(1), [open(2), done(1)])!;
    expect(lines[0]).toMatchObject({ no: 2, open: true, canOpenReport: false, regen: [] });
  });
});
