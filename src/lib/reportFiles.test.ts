import { describe, expect, it } from 'vitest';
import { MAX_PDF_ATTEMPTS } from '../../api/_lib/pdfState';
import { LANGS } from '../../api/_lib/lang';
import {
  availabilityOf,
  cardsFor,
  downloadableIn,
  langStates,
  offerableLangs,
  pdfObjectPath,
  shareCardObjectPath,
  type ReportFileRow,
} from '../../api/_lib/reportFiles';

const row = (over: Partial<ReportFileRow> = {}): ReportFileRow => ({
  lang: 'zh',
  pdf_status: 'ready',
  pdf_path: 's1-zh.pdf',
  pdf_attempts: 0,
  ...over,
});

describe('availability collapses five db states into what the UI actually distinguishes', () => {
  it('ready with a path is downloadable', () => {
    expect(availabilityOf(row())).toBe('ready');
  });

  it('ready WITHOUT a path is not downloadable', () => {
    /**
     * 【这不是理论情况】上传成功之后写库那一步失败过一次 —— 那时状态是 ready 而文件不在。
     * 以「有没有文件」为准,否则下载按钮会给出一个 404。
     */
    expect(availabilityOf(row({ pdf_path: null }))).toBe('failed');
  });

  it('pending and rendering are the same thing to the person waiting', () => {
    expect(availabilityOf(row({ pdf_status: 'pending', pdf_path: null }))).toBe('working');
    expect(availabilityOf(row({ pdf_status: 'rendering', pdf_path: null }))).toBe('working');
  });

  it('failed under the cap can retry; at the cap it is exhausted', () => {
    expect(availabilityOf(row({ pdf_status: 'failed', pdf_path: null, pdf_attempts: 1 }))).toBe('failed');
    expect(
      availabilityOf(row({ pdf_status: 'failed', pdf_path: null, pdf_attempts: MAX_PDF_ATTEMPTS })),
    ).toBe('exhausted');
    expect(availabilityOf(row({ pdf_status: 'failed_permanent', pdf_path: null }))).toBe('exhausted');
  });

  it('an unknown status is treated as needing a human, never as downloadable', () => {
    // 认不出的状态按「可以下载」处理会把一个坏文件递出去;按「需要人看」处理最坏是多看一眼
    expect(availabilityOf(row({ pdf_status: 'weird', pdf_path: 's1-zh.pdf' }))).toBe('exhausted');
  });

  it('no row at all means absent, not failed', () => {
    /**
     * 【absent 与 failed 必须分开】absent 要给「生成英文版」,
     * failed 要给「重试」+ 错误详情。合成一个的话,一个从没请求过的语言会显示成
     * 「失败了」—— 而那会让人去找一个不存在的错误。
     */
    expect(availabilityOf(undefined)).toBe('absent');
    expect(availabilityOf(null)).toBe('absent');
  });
});

describe('langStates always covers every language', () => {
  it('a missing language shows up as absent — that is the「—」cell in the roster', () => {
    /**
     * Roster 要显示「zh ✓ / en —」,而那个「—」恰恰来自**没有行**的那种语言。
     * 只返回已有行的话,补全逻辑会散在三处 UI 里。
     */
    const states = langStates([row()]);
    expect(states.map((s) => s.lang)).toEqual([...LANGS]);
    expect(states.find((s) => s.lang === 'zh')!.availability).toBe('ready');
    expect(states.find((s) => s.lang === 'en')!.availability).toBe('absent');
  });

  it('one language ready and the other failed is representable', () => {
    /**
     * 这条是选 B 方案的直接后果:如果只有一个聚合状态,
     * 「中文好了英文失败了」这个状态**没有表达方式** —— 而它是最常见的一种。
     */
    const states = langStates([
      row(),
      row({ lang: 'en', pdf_status: 'failed', pdf_path: null, pdf_attempts: 1, pdf_last_error: 'font 404' }),
    ]);
    expect(states.map((s) => s.availability)).toEqual(['ready', 'failed']);
    expect(states[1].lastError).toBe('font 404');
  });
});

describe('downloadableIn answers「can this person download THEIR language」', () => {
  it('gives nothing when the other language is the ready one', () => {
    /**
     * 找错语言的失败形态是安静的:递过去的文件确实能打开,只是语言不对。
     * 所以这条断言的重点是**没有回退**:en 没有就是没有,不能拿 zh 那份顶。
     */
    const rows = [row()];
    expect(downloadableIn(rows, 'zh')?.path).toBe('s1-zh.pdf');
    expect(downloadableIn(rows, 'en')).toBeNull();
  });
});

describe('offerableLangs decides where the「generate X」action appears', () => {
  it('offers absent and failed, never working or exhausted', () => {
    /**
     * working 时再给按钮等于邀请人再触发一次,而每次触发都是一次 Lambda。
     * exhausted 时人点了也不会好,按钮该让位给「去看错误」。
     */
    expect(offerableLangs([row()])).toEqual(['en']); // zh 已 ready,en 从没有过
    expect(offerableLangs([row({ pdf_status: 'pending', pdf_path: null }), row({ lang: 'en' })])).toEqual([]);
    expect(
      offerableLangs([row({ pdf_status: 'failed', pdf_path: null, pdf_attempts: 1 }), row({ lang: 'en' })]),
    ).toEqual(['zh']);
    expect(
      offerableLangs([row({ pdf_status: 'failed_permanent', pdf_path: null }), row({ lang: 'en' })]),
    ).toEqual([]);
  });

  it('offers both when nothing has been rendered yet', () => {
    expect(offerableLangs([])).toEqual([...LANGS]);
  });
});

describe('object paths keep the two languages apart', () => {
  it('the language is in the filename, so neither overwrites the other', () => {
    /**
     * 【为什么语言必须进路径】两种语言写同一个对象的话,后渲的覆盖先渲的 ——
     * 而「覆盖」正是 B 方案要避免的那件事:切回去应该直接给已有的那一份。
     */
    expect(pdfObjectPath('s1', 'zh')).toBe('s1-zh.pdf');
    expect(pdfObjectPath('s1', 'en')).toBe('s1-en.pdf');
    expect(pdfObjectPath('s1', 'zh')).not.toBe(pdfObjectPath('s1', 'en'));
  });

  it('share cards are per language too', () => {
    // 分享卡渲的是报告页的内容(含档位名),所以它同样跟语言有关
    expect(shareCardObjectPath('s1', 'en', '-card.png')).toBe('s1-en-card.png');
    expect(shareCardObjectPath('s1', 'zh', '-card-tall.png')).toBe('s1-zh-card-tall.png');
  });
});

describe('cardsFor: the page picks its own language, never falls back', () => {
  const files = [
    { lang: 'zh', cardUrl: 's1-zh-card.png', cardTallUrl: 's1-zh-card-tall.png' },
    { lang: 'en', cardUrl: 's1-en-card.png', cardTallUrl: null },
  ];

  it('picks the cards of the requested language', () => {
    expect(cardsFor(files, 'en')).toEqual({ cardUrl: 's1-en-card.png', cardTallUrl: null });
    expect(cardsFor(files, 'zh')).toEqual({
      cardUrl: 's1-zh-card.png',
      cardTallUrl: 's1-zh-card-tall.png',
    });
  });

  it('never falls back to the other language', () => {
    /**
     * 【这一条是那个 bug 的判定】分享卡的语言错了三次,而每次的表现都一样:
     * 英文报告里嵌着一张中文卡 —— 那张图确实能打开,只是语言不对,
     * 而它是客户拿去发朋友圈的东西。所以宁可这一块整个不渲。
     */
    expect(cardsFor([files[0]], 'en')).toEqual({ cardUrl: null, cardTallUrl: null });
    expect(cardsFor([], 'zh')).toEqual({ cardUrl: null, cardTallUrl: null });
  });

  it('a missing tall card does not hide the square one', () => {
    // 两个尺寸各自独立 —— 一个没出来不该把另一个也藏掉
    expect(cardsFor(files, 'en').cardUrl).toBe('s1-en-card.png');
  });
});
