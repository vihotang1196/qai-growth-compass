import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '@/lib/i18n';
import { UI_STRINGS } from '@/config/ui-strings';
import RosterRow, { type RosterRowData } from '@/pages/admin/RosterRow';

/**
 * 断言落在**真实的行标记**上,不是测试里另写一份差不多的副本 —— 判断标准 4 与 8。
 * (Roster 本身在 SSR 下只渲得出 loading 态,数据是 useEffect 拉的,所以行被抽成了组件。)
 */

/** pdf_last_error 入库时截到 1000 字符,所以最坏情况就是这么长的一条 */
const LONG_ERROR =
  'CJK fallback font download failed: Unexpected status code: 404. — ' +
  'url=https://cdn.example.test/fonts/NotoSansSC-Regular.otf, ' +
  'FONTCONFIG_PATH=/tmp/fonts, HOME=/tmp, dirBefore=["fonts.conf"]. ' +
  'x'.repeat(700);

/**
 * 渲出来的是 HTML,`"` 会变成 `&quot;` —— 拿原串直接比会假红。
 * 这里转义后再比,断言的仍然是「整段原文一字不差地落在页面上」。
 */
const escapeHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 报告文件那几行 —— **每种语言一行**(`assessment_report_files` 的粒度)。
 *
 * 【为什么 fixture 必须换成这个形状】组件读的是 `session.files`,
 * 而这份 fixture 之前还挂在 `result.pdf_status` 上 —— 那些字段 roster 的查询
 * **已经不再 select**,所以它们恒为 undefined。
 * 断言还在,但它们验的是一个组件根本不读的东西
 * (判断标准 1 推论三里的第三种绿:**前提在 fixture 里不成立**)。
 * 这一批 9 条红就是这么暴露的 —— 而它们之前被一个 lint 错误挡在 verify 后面。
 */
function makeFiles(
  over: Partial<{
    lang: string;
    pdf_status: string;
    pdf_path: string | null;
    pdf_attempts: number | null;
    pdf_last_error: string | null;
    share_card_error: string | null;
  }> = {},
) {
  return [
    {
      lang: 'zh',
      pdf_status: 'ready',
      pdf_path: 'ses-1-zh.pdf',
      pdf_attempts: 0,
      pdf_last_error: null,
      share_card_error: null,
      ...over,
    },
  ];
}

function makeRow(over: Partial<RosterRowData> = {}): RosterRowData {
  return {
    id: 'ent-1',
    name: 'Test Person',
    phone_e164: '+60123456789',
    phone_raw: '+60123456789',
    email_lower: 'a@example.test',
    status: 'completed',
    first_login_at: '2026-08-01T10:00:00Z',
    completed_at: '2026-08-01T10:30:00Z',
    access_revoked_at: null,
    cohort: { id: 'c1', name: 'Batch 1', is_test: false },
    session: {
      id: 'ses-1',
      status: 'completed',
      result: { total: 3.4, tier: 'spot', weakest: ['traffic', 'value'] },
      files: makeFiles({ pdf_status: 'failed', pdf_path: null, pdf_attempts: 1, pdf_last_error: LONG_ERROR }),
    },
    ...over,
  };
}

function render(row: RosterRowData, errorOpen = false): string {
  const noop = () => {};
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(
        'table',
        null,
        createElement(
          'tbody',
          null,
          createElement(RosterRow, {
            row,
            busy: false,
            errorOpen,
            onToggleError: noop,
            onResend: noop,
            onRotate: noop,
            onRevoke: noop,
            onRenderPdf: noop,
            onOpenReport: noop,
          }),
        ),
      ),
    ),
  );
}

const ready = () =>
  makeRow({
    session: {
      id: 'ses-1',
      status: 'completed',
      result: { total: 3.4, tier: 'spot', weakest: ['traffic'] },
      files: makeFiles(),
    },
  });

/** 主行(第一个 <tr>)—— 详情行是第二个,分开数才有意义 */
function mainRow(html: string): string {
  return html.slice(0, html.indexOf('</tr>'));
}

/** 主行的最后一格 = 操作区。按钮个数要在这里数,PDF 列那个开关不算 */
function actionsCell(html: string): string {
  const row = mainRow(html);
  return row.slice(row.lastIndexOf('<td'));
}

/**
 * 【文案从 UI_STRINGS 取,不写字面量】两个原因:
 *   1. src/** 的字面量一律英文(lint:cjk),而 SSR 下 resolveInitialLocale 拿不到 window,
 *      默认落在 zh —— 渲出来的就是中文;
 *   2. 写死英文文案会让这几条断言在改文案时假红。要验的是「这个 key 的文案出现在这里」。
 */
const zh = (k: keyof typeof UI_STRINGS) => UI_STRINGS[k].zh;

describe('a failed PDF must not push the action buttons off screen', () => {
  it('the error text is nowhere in the row while collapsed', () => {
    /**
     * 【原来为什么会横穿操作区】错误文本直接渲在 PDF 那一列里,带着
     * `max-w-[16rem] break-words` —— 两个类都不生效:Td 有 whitespace-nowrap,
     * 会继承给里面的文本,于是没有任何换行机会,一条 1000 字符的横线把最后一列
     * (操作区)推到屏幕外。而失败那一行恰恰是最需要立刻操作的一行。
     */
    const html = render(makeRow());
    expect(html).not.toContain(escapeHtml(LONG_ERROR));
    expect(html).not.toContain('Unexpected status code');
  });

  it('but there is a fixed-width way to get to it', () => {
    const html = render(makeRow());
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(zh('admin.pdf.showError'));
  });

  it('expanding puts the full text in a row of its own, not in the column', () => {
    const html = render(makeRow(), true);
    expect(html).toContain(escapeHtml(LONG_ERROR));
    // 详情在主行【之外】—— 在列里就等于又占列宽
    expect(mainRow(html)).not.toContain('Unexpected status code');
    expect(html.toLowerCase()).toContain('colspan=');
  });

  it('the detail row spans exactly as many columns as the row has cells', () => {
    /**
     * 【为什么不拿 ROSTER_COLUMNS.length 去比】那是 colSpan 的来源,拿它断言等于
     * 「代码和自己一致」(判断标准 8)。数真实渲出来的 <td> 才是独立的一方 ——
     * 加了一列却忘了加进 ROSTER_COLUMNS,这条会红。
     */
    const html = render(makeRow(), true);
    const cells = (mainRow(html).match(/<td/g) ?? []).length;
    expect(cells).toBeGreaterThan(0);
    expect(html.toLowerCase()).toContain(`colspan="${cells}"`);
  });

  it('the detail text can wrap — it must beat the nowrap it inherits from Td', () => {
    const html = render(makeRow(), true);
    expect(html).toContain('whitespace-pre-wrap');
  });
});

describe('the view-report button is enabled by having a result, not by pdf_status', () => {
  /**
   * 上一版是硬编码 `disabled` 的 Stage 8 占位 —— 所以点「重新生成 PDF」永远不会
   * 让它变,它压根没有启用条件。现在的条件是「有 result」:
   * 报告页读的是 assessment_results,与 PDF 渲染无关 ——
   * **PDF 失败的人报告照样能看**,那正是整条异步化的取向。
   */
  const withResult = (pdf_status: string, pdf_last_error: string | null = null) =>
    makeRow({
      session: {
        id: 's',
        status: 'completed',
        result: { total: 3.4, tier: 'spot', weakest: ['traffic'] },
        files: makeFiles({
          pdf_status,
          pdf_path: pdf_status === 'ready' ? 'ses-1-zh.pdf' : null,
          pdf_attempts: pdf_status === 'ready' ? 0 : 1,
          pdf_last_error,
        }),
      },
    });

  /**
   * 操作区里第一个按钮就是「查看报告」。
   *
   * 【断言要看 `disabled=""` 属性,不能搜 "disabled"】className 里有
   * Tailwind 的 `disabled:pointer-events-none` —— 第一版搜子串 "disabled",
   * 于是三条断言全部假红。**断言的边界要落在属性上,不是整段字符串上。**
   */
  const reportDisabled = (html: string) => {
    const cell = actionsCell(html);
    const btn = cell.slice(cell.indexOf('<button'), cell.indexOf('</button>') + 9);
    return /\sdisabled=""/.test(btn);
  };

  it('a row with a result can open the report', () => {
    expect(reportDisabled(render(withResult('ready')))).toBe(false);
  });

  it('PDF failure does not block the report — that is the whole point of the async split', () => {
    expect(reportDisabled(render(withResult('failed_permanent', 'boom')))).toBe(false);
  });

  it('pending PDF does not block it either', () => {
    expect(reportDisabled(render(withResult('pending')))).toBe(false);
  });

  it('a row with no result cannot — the report would only say "not ready"', () => {
    const html = render(makeRow({ session: { id: 's', status: 'in_progress', result: null } }));
    expect(reportDisabled(html)).toBe(true);
  });
});

describe('the re-generate button keeps its place instead of appearing and disappearing', () => {
  it('a ready row still renders the button, only invisible', () => {
    /**
     * 只在非 ready 时渲的话,这一格的宽度随行变化,而列宽取所有行里最宽的那个 ——
     * ready 行右侧多出一块空档,整列看起来在抖。留空则按钮永远在同一个横坐标上。
     */
    const html = render(ready());
    // 【每种语言一个按钮】文案带语言名 —— 一个 session 现在有两份文件
    expect(html).toContain(zh('admin.file.regen').replace('{lang}', 'zh'));
    expect(html).toContain(zh('admin.file.regen').replace('{lang}', 'en'));
    // zh 那份是 ready,所以它那颗占位隐形(en 那颗是实的)
    expect(actionsCell(html)).toContain('invisible');
  });

  it('a ready row cannot actually fire it', () => {
    const html = render(ready());
    // 占位的那个必须是禁用且对读屏隐藏的,否则等于多了一个假按钮
    expect(html).toContain('aria-hidden="true"');
    expect(mainRow(html)).toContain('disabled');
  });

  it('a failed row shows the same button, visible and live', () => {
    const html = render(makeRow());
    expect(html).toContain(zh('admin.file.regen').replace('{lang}', 'zh'));
    // 两种语言都不是 ready(zh failed / en absent),所以一颗占位的都没有
    expect(actionsCell(html)).not.toContain('invisible');
  });

  it('ready and failed rows render the same number of buttons', () => {
    // 位置固定这件事的结构性表述:两种行的按钮个数必须一样
    // 只数操作区那一格 —— PDF 列的「看错误」开关本来就只在有错误时才有
    const count = (html: string) => (actionsCell(html).match(/<button/g) ?? []).length;
    expect(count(render(ready()))).toBe(count(render(makeRow())));
    // 【6 而不是 5】重新生成按钮从一颗变成每种语言一颗 —— 这个数字要跟着语言数走
    expect(count(render(ready()))).toBe(6);
  });

  it('a test-cohort row is labelled so, once it is shown at all', () => {
    /**
     * 名单默认隐藏测试行,但一旦显示出来就必须看得出哪几条是假的 ——
     * 显示了却分不清,比不显示更糟:运营会把演示记录当成真实学员去跟进。
     */
    const html = render(makeRow({ cohort: { id: 'c9', name: 'Demo', is_test: true } }));
    expect(html).toContain(zh('admin.testBadge'));
  });

  it('a real row carries no test badge', () => {
    // 反向锁:徽章不是每行都有
    expect(render(makeRow())).not.toContain(zh('admin.testBadge'));
  });

  it('a share card failure never makes the PDF look broken', () => {
    /**
     * 两者是分开的:PDF ready + 分享卡失败,是真实且常见的一种组合。
     * 把分享卡的错误混进 PDF 那一列,会让运营以为报告本身出了问题。
     */
    const html = render(
      makeRow({
        session: {
          id: 's',
          status: 'completed',
          result: { total: 3.4, tier: 'spot', weakest: ['traffic'] },
          files: makeFiles({ share_card_error: 'share card element #share-card-tall not found' }),
        },
      }),
      true,
    );
    /**
     * PDF 那一格仍然是「zh ✓」——【断言换成新的记号,不是旧的状态字面量】
     * 上一版这里断言的是 HTML 里出现字符串 `ready`(那时格子里渲的是 pdf_status 本身)。
     * 新的一格渲的是记号,所以旧断言只会假红/假绿 —— 它验的是一个不再存在的表示法。
     */
    expect(mainRow(html)).toContain(`zh ${zh('admin.file.ready')}`);
    expect(actionsCell(html)).toContain('invisible');
    // 而分享卡的错误确实可见,并且带着「不影响 PDF」这句话
    expect(html).toContain('share-card-tall');
    expect(html).toContain(zh('admin.card.errorLabel'));
  });

  it('with a result but no files yet, the cell shows both languages as absent', () => {
    /**
     * 【为什么不是空白】空白会让人以为那一列坏了。
     * 而「答完了却一份文件都没有」恰恰是要动手的那种 —— finalize 那次异步触发可能丢了,
     * sweep 会捡回来,但看得见比看不见好。
     */
    const html = mainRow(
      render(makeRow({ session: { id: 's', status: 'completed', result: { total: 3.4, tier: 'spot', weakest: ['traffic'] }, files: [] } })),
    );
    expect(html).toContain(`zh ${zh('admin.file.absent')}`);
    expect(html).toContain(`en ${zh('admin.file.absent')}`);
  });

  it('a row with no result shows a plain dash, NOT two absent languages', () => {
    /**
     * 【这一条钉的是那个区分】没答完的人本来就不可能有 PDF ——
     * 给他显示「zh — / en —」是噪音,而名单页是用来**扫**的:
     * 每多一格没有行动含义的东西,真正要动手的那几行就更难被看见。
     * 其余空列(总分 / 档位 / 最弱)也都是一个普通破折号,这一格跟它们一致。
     */
    const html = mainRow(render(makeRow({ session: { id: 's', status: 'in_progress', result: null } })));
    expect(html).not.toContain(`zh ${zh('admin.file.absent')}`);
    expect(html).toContain('—');
  });

  it('a row with no result at all renders neither the badge nor the button', () => {
    // 反向锁:上面两条不是恒真 —— 没答完的人本来就没有 PDF 可言
    const html = render(makeRow({ session: { id: 's', status: 'in_progress', result: null } }));
    expect(html).not.toContain(zh('admin.pdf.rendering'));
  });
});
