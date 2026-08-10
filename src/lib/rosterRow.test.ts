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
      result: {
        total: 3.4,
        tier: 'spot',
        weakest: ['traffic', 'value'],
        pdf_status: 'failed',
        pdf_last_error: LONG_ERROR,
        share_card_error: null,
      },
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
      result: {
        total: 3.4,
        tier: 'spot',
        weakest: ['traffic'],
        pdf_status: 'ready',
        pdf_last_error: null,
        share_card_error: null,
      },
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

describe('the re-generate button keeps its place instead of appearing and disappearing', () => {
  it('a ready row still renders the button, only invisible', () => {
    /**
     * 只在非 ready 时渲的话,这一格的宽度随行变化,而列宽取所有行里最宽的那个 ——
     * ready 行右侧多出一块空档,整列看起来在抖。留空则按钮永远在同一个横坐标上。
     */
    const html = render(ready());
    expect(html).toContain(zh('admin.action.renderPdf'));
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
    expect(html).toContain(zh('admin.action.renderPdf'));
    expect(actionsCell(html)).not.toContain('invisible');
  });

  it('ready and failed rows render the same number of buttons', () => {
    // 位置固定这件事的结构性表述:两种行的按钮个数必须一样
    // 只数操作区那一格 —— PDF 列的「看错误」开关本来就只在有错误时才有
    const count = (html: string) => (actionsCell(html).match(/<button/g) ?? []).length;
    expect(count(render(ready()))).toBe(count(render(makeRow())));
    expect(count(render(ready()))).toBe(5);
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
          result: {
            total: 3.4,
            tier: 'spot',
            weakest: ['traffic'],
            pdf_status: 'ready',
            pdf_last_error: null,
            share_card_error: 'share card element #share-card-tall not found',
          },
        },
      }),
      true,
    );
    // PDF 那颗徽章仍然是 ready,且重新生成按钮仍然是占位的隐形态
    expect(mainRow(html)).toContain('ready');
    expect(actionsCell(html)).toContain('invisible');
    // 而分享卡的错误确实可见,并且带着「不影响 PDF」这句话
    expect(html).toContain('share-card-tall');
    expect(html).toContain(zh('admin.card.errorLabel'));
  });

  it('a row with no result at all renders neither the badge nor the button', () => {
    // 反向锁:上面两条不是恒真 —— 没答完的人本来就没有 PDF 可言
    const html = render(makeRow({ session: { id: 's', status: 'in_progress', result: null } }));
    expect(html).not.toContain(zh('admin.action.renderPdf'));
  });
});
