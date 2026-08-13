import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '@/lib/i18n';
import { UI_STRINGS } from '@/config/ui-strings';
import RosterRow, { type RosterRowData } from '@/pages/admin/RosterRow';
import {
  parseWarnings,
  warningLabelKey,
  WARNING_CODES,
} from '../../api/_lib/entitlementWarnings';

describe('every warning code must have copy', () => {
  it('WARNING_CODES and ui-strings match one to one', () => {
    /**
     * 漏一条的表现是名单页那一格显示成 key 本身(或者空白)——
     * **一条看不懂的告警比没有告警更容易被忽略**,因为它看起来「已经在显示了」。
     * 所以这条把「码的取值域」与「文案表」钉在一起:以后加一个码忘了写文案,这里会红。
     */
    for (const code of WARNING_CODES) {
      const key = warningLabelKey(code);
      expect(UI_STRINGS[key as keyof typeof UI_STRINGS], key).toBeDefined();
    }
  });

  it('both zh and en are non-empty — Stage 12 ships a full English build', () => {
    for (const code of WARNING_CODES) {
      const entry = UI_STRINGS[warningLabelKey(code) as keyof typeof UI_STRINGS];
      expect(entry.zh.length, code).toBeGreaterThan(0);
      expect(entry.en.length, code).toBeGreaterThan(0);
    }
  });
});

describe('parseWarnings: a bad value must not break the roster page', () => {
  it('null, non-arrays and empty arrays all yield []', () => {
    for (const raw of [null, undefined, {}, 'phone_unparseable', 42, []]) {
      expect(parseWarnings(raw)).toEqual([]);
    }
  });

  it('drops unrecognised entries, keeps the rest, never throws', () => {
    /**
     * 这一列是 jsonb、历史行是 null、以后可能被手工改过。
     * 一个坏项让整页崩掉的代价远大于少显示一条告警。
     */
    const raw = [
      { code: 'lang_invalid', context: 'EN' },
      { code: 'not_a_real_code' },
      null,
      'no_contact_channel', // 兼容早期只有 code 的形状
      { context: 'no code at all' },
      { code: 'phone_unparseable', context: 12 }, // context 不是字符串 → 丢掉 context,保留 code
    ];
    expect(parseWarnings(raw)).toEqual([
      { code: 'lang_invalid', context: 'EN' },
      { code: 'no_contact_channel' },
      { code: 'phone_unparseable' },
    ]);
  });
});

const BASE: RosterRowData = {
  id: 'r1',
  name: 'Tester',
  phone_e164: '+60123456789',
  phone_raw: '0123456789',
  email_lower: 'a@b.com',
  status: 'completed',
  first_login_at: null,
  completed_at: null,
  access_revoked_at: null,
  cohort: { id: 'c1', name: 'KL Batch 3', is_test: false },
  session: null,
};

function render(row: RosterRowData, errorOpen = false): string {
  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement('table', null, createElement('tbody', null,
        createElement(RosterRow, {
          row,
          busy: false,
          errorOpen,
          onToggleError: () => {},
          onResend: () => {},
          onRotate: () => {},
          onRevoke: () => {},
          onRenderPdf: () => {},
          onOpenReport: () => {},
        }),
      )),
    ),
  );
}
const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('the roster warnings cell', () => {
  it('shows a count, not an icon', () => {
    /**
     * 【为什么钉「条数」】一个感叹号图标每天都在那里,看它一眼得不到可行动的信息,
     * 一周之后没人再看它。条数是个**会变的数字**,变了人会注意到。
     */
    const html = visible(render({ ...BASE, warnings: [{ code: 'lang_invalid', context: 'EN' }, { code: 'no_contact_channel' }] }));
    expect(html).toContain(UI_STRINGS['admin.warnCount'].zh.replace('{n}', '2'));
  });

  it('renders no button when there are no warnings — reverse lock', () => {
    // 没有这条,「永远显示一个 0 条」也能让上面那条绿,而那又变成装饰
    const html = render({ ...BASE, warnings: [] });
    expect(html).not.toContain('aria-controls="row-detail-r1"');
  });

  it('lists each warning with its context — the where-to-fix cell', () => {
    /**
     * `lang_invalid` 不带上收到的那个值(`EN`),运营只知道「有问题」,
     * 不知道 GHL 那边填了什么(判断标准 9)。
     */
    const html = visible(
      render({ ...BASE, warnings: [{ code: 'lang_invalid', context: 'EN' }] }, true),
    );
    expect(html).toContain(UI_STRINGS['warn.lang_invalid'].zh);
    expect(html).toContain('EN');
  });

  it('phone warnings never put the raw number in context', () => {
    /**
     * warnings 会显示在名单页上、也可能被导出 —— 号码是 PII,
     * 而完整原值在 `phone_raw` 里本来就有。context 只放形状。
     */
    const html = visible(
      render({ ...BASE, warnings: [{ code: 'phone_unparseable', context: '12 chars, has letters' }] }, true),
    );
    expect(html).toContain(UI_STRINGS['warn.phone_unparseable'].zh);
    expect(html).not.toContain('0123456789 chars');
  });
});
