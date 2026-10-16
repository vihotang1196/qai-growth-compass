import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '@/lib/i18n';
import { UI_STRINGS } from '@/config/ui-strings';
import { DashboardSample } from '@/pages/admin/CohortDashboard';

/**
 * 看板顶上的人数行(重填第 4 步):「本批 N 人已完成」后面多一句「其中 M 人重填过」。
 * N 来自视图(每人最新完成的一份),所以重填不会让 N 变大 —— 那一句同时把这件事说出来。
 */
const zh = (k: keyof typeof UI_STRINGS, n: number) => UI_STRINGS[k].zh.replace('{n}', String(n));
const render = (n: number, retaken?: number | null) =>
  renderToStaticMarkup(createElement(LocaleProvider, null, createElement(DashboardSample, { n, retaken })));

describe('DashboardSample', () => {
  it('says how many retook it, also when that is zero (today, real cohorts)', () => {
    const html = render(92, 0);
    expect(html).toContain(zh('dash.n', 92));
    expect(html).toContain(zh('dash.retaken', 0));
  });

  it('the test cohort on 2026-10-16: one person retook it', () => {
    expect(render(6, 1)).toContain(zh('dash.retaken', 1));
  });

  it('an older server without the count: only the head count, no made-up zero', () => {
    const html = render(92, undefined);
    expect(html).toContain(zh('dash.n', 92));
    expect(html).not.toContain(UI_STRINGS['dash.retaken'].zh.split('{n}')[1]);
  });
});
