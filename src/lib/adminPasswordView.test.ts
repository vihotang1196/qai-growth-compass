import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '@/lib/i18n';
import { UI_STRINGS } from '@/config/ui-strings';
import AdminLogin from '@/pages/admin/AdminLogin';
import AdminPasswordPanel from '@/pages/admin/AdminPasswordPanel';
import { ADMIN_PASSWORD_MIN_LENGTH } from '@/lib/adminPasswordAuth';

const zh = (k: keyof typeof UI_STRINGS) => UI_STRINGS[k].zh;
const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(LocaleProvider, null, el));

describe('admin login page', () => {
  it('defaults to email + password, with the email link kept as the fallback entry', () => {
    const html = render(createElement(AdminLogin, {}));
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain(zh('admin.login.passwordAction'));
    // 备用入口在,但默认不是它:发送链接的按钮不在默认视图里
    expect(html).toContain(zh('admin.login.useLink'));
    expect(html).not.toContain(zh('admin.login.action'));
  });

  it('still shows the not-on-the-allowlist notice above the form', () => {
    const html = render(createElement(AdminLogin, { forbidden: true }));
    expect(html).toContain(zh('admin.forbidden'));
    expect(html).toContain('type="password"');
  });
});

describe('set-password panel', () => {
  it('asks for the new password twice, marked as a new password for password managers', () => {
    const html = render(createElement(AdminPasswordPanel, { onClose: () => {} }));
    expect(html.match(/type="password"/g)).toHaveLength(2);
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(html).toContain(zh('admin.password.save'));
    expect(html).toContain(zh('admin.password.hint').replace('{n}', String(ADMIN_PASSWORD_MIN_LENGTH)));
  });
});
