import { describe, expect, it } from 'vitest';
import {
  MAX_PDF_ATTEMPTS,
  PDF_PENDING_STALE_MS,
  PDF_RENDERING_STALE_MS,
  pdfSweepReason,
  type PdfSweepRow,
} from '../../api/_lib/pdfState';

const NOW = 1_800_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function row(over: Partial<PdfSweepRow> = {}): PdfSweepRow {
  return {
    session_id: 'ses-1',
    pdf_status: 'pending',
    pdf_attempts: 0,
    pdf_status_at: iso(60 * 60_000), // 一小时前,足够陈旧
    computed_at: iso(60 * 60_000),
    ...over,
  };
}

describe('the sweep only picks rows that the endpoint would actually accept', () => {
  it('never picks a row that has used up its attempts', () => {
    /**
     * 端点的守卫看的是 pdf_attempts >= MAX,不是状态。挑人边界必须等于收人边界,
     * 否则每次 cron 都白打一串必然 409 的请求,而日志里看起来一切正常。
     */
    for (const status of ['pending', 'failed', 'rendering']) {
      expect(pdfSweepReason(row({ pdf_status: status, pdf_attempts: MAX_PDF_ATTEMPTS }), NOW)).toBeNull();
    }
  });

  it('picks a failed row that still has attempts left', () => {
    expect(pdfSweepReason(row({ pdf_status: 'failed', pdf_attempts: 2 }), NOW)).toBe('failed_retry');
  });

  it('never picks failed_permanent — retrying it a thousand times changes nothing', () => {
    // 就算有人手工把 attempts 清了,状态本身也说明这是 D9 的 CONFIG 类
    expect(pdfSweepReason(row({ pdf_status: 'failed_permanent', pdf_attempts: 0 }), NOW)).toBeNull();
  });

  it('never picks a ready row', () => {
    expect(pdfSweepReason(row({ pdf_status: 'ready', pdf_attempts: 1 }), NOW)).toBeNull();
  });

  it('never picks a status it does not recognise', () => {
    // 将来加了新状态,默认是【不动】—— 让人来决定,而不是替它猜
    expect(pdfSweepReason(row({ pdf_status: 'archived' }), NOW)).toBeNull();
  });
});

describe('staleness is what separates "still running" from "never started"', () => {
  it('leaves a freshly finalised pending row alone', () => {
    // finalize 刚触发过渲染 —— 这时插一脚就是平白多烧一次 Chromium
    expect(pdfSweepReason(row({ pdf_status: 'pending', pdf_status_at: iso(5_000) }), NOW)).toBeNull();
  });

  it('picks a pending row once the trigger has clearly been lost', () => {
    expect(pdfSweepReason(row({ pdf_status: 'pending', pdf_status_at: iso(PDF_PENDING_STALE_MS) }), NOW)).toBe(
      'pending_trigger_lost',
    );
  });

  it('leaves a rendering row alone while it could still legitimately be running', () => {
    // 渲染约 16 秒,函数上限 60 秒 —— 一分钟前开始的那条完全可能还在跑
    expect(pdfSweepReason(row({ pdf_status: 'rendering', pdf_status_at: iso(60_000) }), NOW)).toBeNull();
  });

  it('picks a rendering row that has clearly died mid-render', () => {
    expect(
      pdfSweepReason(row({ pdf_status: 'rendering', pdf_status_at: iso(PDF_RENDERING_STALE_MS) }), NOW),
    ).toBe('rendering_stuck');
  });

  it('rendering gets a longer grace period than pending', () => {
    /**
     * 写死的方向断言(判断标准 8):两个阈值都从常量取的话,把它们对调也不会红。
     * 这条钉住的是【意图】—— rendering 是「可能真的在跑」,pending 是「压根没被触发」,
     * 前者必须更宽容。
     */
    expect(PDF_RENDERING_STALE_MS).toBeGreaterThan(PDF_PENDING_STALE_MS);

    const at = iso(4 * 60_000); // 4 分钟:超过 pending 阈值,不到 rendering 阈值
    expect(pdfSweepReason(row({ pdf_status: 'pending', pdf_status_at: at }), NOW)).toBe('pending_trigger_lost');
    expect(pdfSweepReason(row({ pdf_status: 'rendering', pdf_status_at: at }), NOW)).toBeNull();
  });

  it('a failed row is retried immediately — there is nothing in flight to wait for', () => {
    expect(pdfSweepReason(row({ pdf_status: 'failed', pdf_status_at: iso(1_000) }), NOW)).toBe('failed_retry');
  });
});

describe('the timestamp fallback survives the migration landing before the code', () => {
  it('falls back to computed_at when pdf_status_at is still null', () => {
    // 老行、以及迁移先于代码上线的那段时间
    expect(
      pdfSweepReason(row({ pdf_status: 'rendering', pdf_status_at: null, computed_at: iso(60 * 60_000) }), NOW),
    ).toBe('rendering_stuck');
  });

  it('a null pdf_status_at on a fresh row still gets the grace period', () => {
    expect(
      pdfSweepReason(row({ pdf_status: 'pending', pdf_status_at: null, computed_at: iso(5_000) }), NOW),
    ).toBeNull();
  });

  it('an unparseable timestamp means leave it alone, not sweep it forever', () => {
    // 坏值下宁可漏一条等人发现,也不要反复烧渲染
    expect(
      pdfSweepReason(row({ pdf_status: 'failed', pdf_status_at: 'not-a-date', computed_at: 'also-bad' }), NOW),
    ).toBeNull();
  });
});
