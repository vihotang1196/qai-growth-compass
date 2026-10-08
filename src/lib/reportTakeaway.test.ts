import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '@/lib/i18n';
import { UI_STRINGS } from '@/config/ui-strings';
import ReportTakeaway from '@/pages/ReportTakeaway';
import type { ReportPayload } from '@/lib/reportApi';

/**
 * 「带走这份报告」在 PDF 里不出现(Viho 2026-10-08 定)。
 *
 * 2026-10-08 在 X 的中文 PDF 里看到:这一节截下来的是「正在生成中文版…」(PDF 截到了自己生成中的那一刻)、
 * 一个转到一半的转圈方块、一个「生成英文版」按钮 —— 都是网页上的交互,在 PDF 里没有意义。
 * 这一节没有静态内容,所以渲染模式下整节不出现;打印时靠 no-print 整节隐藏。
 */
type Files = ReportPayload['files'];
const file = (lang: 'zh' | 'en', availability: Files[number]['availability']): Files[number] => ({
  lang,
  availability,
  url: null,
  cardUrl: null,
  cardTallUrl: null,
});

function render(renderMode: boolean): string {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(ReportTakeaway, {
        renderMode,
        // PDF 渲染时的真实状态:自己这一份正在渲,另一种语言还没有
        files: [file('zh', 'working'), file('en', 'absent')],
        current: 'zh',
        currentStatus: 'rendering',
        pollDone: false,
        opening: null,
        generating: null,
        onOpen: () => {},
        onGenerate: () => {},
        onPrint: () => {},
      }),
    ),
  );
}

const generating = UI_STRINGS['report.pdf.generatingIn'].zh.replace('{lang}', UI_STRINGS['lang.name.zh'].zh);
const title = UI_STRINGS['report.section.share'].zh;

describe('the take-away section in the PDF', () => {
  it('render mode (the PDF renderer): nothing at all — no generating status, no buttons, no title', () => {
    const html = render(true);
    expect(html).not.toContain(generating);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('qai-spinner');
    expect(html).toBe('');
  });

  // 屏幕上照旧:学员要看见「正在生成」,也要有按钮
  it('on screen it is still there, generating status included', () => {
    const html = render(false);
    expect(html).toContain(title);
    expect(html).toContain(generating);
  });

  // 学员自己按「打印」时整节也不进纸 —— 外层 section 带 no-print(index.css 的打印规则把它隐藏)
  it('printing hides the whole section', () => {
    expect(render(false)).toMatch(/^<section class="[^"]*\bno-print\b/);
  });
});
