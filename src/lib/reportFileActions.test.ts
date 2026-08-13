import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '@/lib/i18n';
import { UI_STRINGS } from '@/config/ui-strings';
import ReportFileActions from '@/pages/ReportFileActions';
import type { ReportPayload } from '@/lib/reportApi';

type Files = ReportPayload['files'];

const file = (
  lang: 'zh' | 'en',
  availability: Files[number]['availability'],
  url: string | null = null,
): Files[number] => ({ lang, availability, url, cardUrl: null, cardTallUrl: null });

function render(
  files: Files,
  over: Partial<{
    current: 'zh' | 'en';
    currentStatus: string;
    pollDone: boolean;
    opening: boolean;
    generating: 'zh' | 'en' | null;
  }> = {},
): string {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(ReportFileActions, {
        files,
        current: over.current ?? 'zh',
        currentStatus: over.currentStatus ?? 'ready',
        pollDone: over.pollDone ?? false,
        opening: over.opening ?? false,
        generating: over.generating ?? null,
        onOpen: () => {},
        onGenerate: () => {},
      }),
    ),
  );
}
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const zhName = UI_STRINGS['lang.name.zh'].zh;
const enName = UI_STRINGS['lang.name.en'].zh;
const download = (name: string) => UI_STRINGS['report.pdf.downloadIn'].zh.replace('{lang}', name);
const generate = (name: string) => UI_STRINGS['report.pdf.generateIn'].zh.replace('{lang}', name);

describe('the language is spelled out, never left to an icon', () => {
  it('the download button names the language', () => {
    /**
     * 一个语言图标每天都在那里,看一眼得不到可行动的信息,一周之后没人再看它 ——
     * 而这里要传达的恰恰是「你正在下载的是哪一种语言」。
     * 所以断言的是**文案里有语言名**,不是「有个按钮」。
     */
    const html = visible(render([file('zh', 'ready', 'u')]));
    expect(html).toContain(download(zhName));
  });

  it('the generate action names the language too', () => {
    const html = visible(render([file('zh', 'ready', 'u'), file('en', 'absent')]));
    expect(html).toContain(generate(enName));
  });
});

describe('two buttons, not a dropdown', () => {
  it('both languages ready renders two separate buttons', () => {
    /**
     * 下拉会把「有两份」藏进一次点击之后。这条钉的是**两个可见的按钮**:
     * 计数 + 两种语言名各出现一次。
     */
    const html = render([file('zh', 'ready', 'a'), file('en', 'ready', 'b')]);
    expect((html.match(/<button/g) ?? []).length).toBe(2);
    const text = visible(html);
    expect(text).toContain(download(zhName));
    expect(text).toContain(download(enName));
    expect(html).not.toContain('<select');
  });
});

describe('what shows up for each availability', () => {
  it('working shows text, not a button — a button would invite a second trigger', () => {
    const html = render([file('zh', 'ready', 'a'), file('en', 'working')]);
    // 只有 zh 那个下载按钮
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(visible(html)).toContain(
      UI_STRINGS['report.pdf.generatingIn'].zh.replace('{lang}', enName),
    );
  });

  it('exhausted explains instead of offering a button that must fail', () => {
    const html = render([file('zh', 'ready', 'a'), file('en', 'exhausted')]);
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(visible(html)).toContain(
      UI_STRINGS['report.pdf.exhaustedIn'].zh.replace('{lang}', enName),
    );
  });

  it('failed on the OTHER language does offer a retry', () => {
    // 还有重试预算 —— 那是他能做点什么的情况,所以给按钮
    const html = render([file('zh', 'ready', 'a'), file('en', 'failed')]);
    expect(visible(html)).toContain(generate(enName));
  });

  it('the current language still rendering shows text, and only after pollDone offers a button', () => {
    /**
     * 当前语言那份是 finalize 触发的,页面打开时可能正在渲 ——
     * 那时给按钮会让他在系统已经在做的事情上再点一次。
     * 轮询放弃之后才给,那时「一直没好」是事实而不是猜测。
     */
    const stillRendering = render([file('zh', 'absent')], { currentStatus: 'pending' });
    expect((stillRendering.match(/<button/g) ?? []).length).toBe(0);

    const gaveUp = render([file('zh', 'absent')], { currentStatus: 'pending', pollDone: true });
    expect(visible(gaveUp)).toContain(generate(zhName));
  });

  it('generating disables the other button — one render at a time', () => {
    const html = render([file('zh', 'failed'), file('en', 'absent')], {
      generating: 'en',
      pollDone: true,
    });
    // en 那个变成「正在生成」文案,zh 那个按钮被禁用
    expect((html.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(visible(html)).toContain(UI_STRINGS['report.pdf.generatingIn'].zh.replace('{lang}', enName));
  });
});

describe('the current language is the primary action', () => {
  it('current gets primary, the other gets outline', () => {
    /**
     * 他当前语言那份才是他要的那份;另一种是补充。
     * 两个同等强调的按钮会让他多想一步「我该点哪个」。
     */
    const html = render([file('zh', 'ready', 'a'), file('en', 'ready', 'b')], { current: 'zh' });
    const zhIndex = html.indexOf(download(zhName));
    const enIndex = html.indexOf(download(enName));
    expect(zhIndex).toBeGreaterThan(-1);
    expect(enIndex).toBeGreaterThan(-1);
    // primary 与 outline 各出现一次(具体类名由 Button 决定,这里只看两者不同)
    const zhBtn = html.slice(0, zhIndex).lastIndexOf('<button');
    const enBtn = html.slice(0, enIndex).lastIndexOf('<button');
    expect(html.slice(zhBtn, zhIndex)).not.toBe(html.slice(enBtn, enIndex));
  });
});

describe('no files at all', () => {
  it('renders nothing rather than an empty box', () => {
    // files 为空只发生在 finalize 之前;那时这一块不该占位置
    expect(visible(render([])).trim()).toBe('');
  });
});
