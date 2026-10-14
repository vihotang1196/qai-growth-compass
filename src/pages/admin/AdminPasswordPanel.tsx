import { useState } from 'react';
import { Button, Card, CardBody, CardHeader, CardTitle, Input } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { supabaseAuth } from '@/lib/supabase';
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  updateAdminPassword,
  type AdminPasswordUpdateNotice,
} from '@/lib/adminPasswordAuth';

/**
 * 后台「设置密码」—— 已登录状态下设置或修改自己的密码。
 *
 * 【没有单独的重置密码页】忘了密码就用邮件链接登录,再到这里改(Viho 2026-10-14 定)。
 * 所以这里是「设置」与「修改」唯一的入口,而它只在已登录之后才出现。
 *
 * 【不要求输入旧密码】Supabase 的 `updateUser` 不收旧密码;想要「改密码前必须最近登录过」,
 * 是 Dashboard 的「Secure password change」那个开关(开着时登录超过 24 小时会被要求重新登录,
 * 这里显示 `admin.password.reauth` 那一句)。要不要开由 Viho 定,列在 PROGRESS。
 *
 * 【页面上只有文案 key】结果只由 `updateAdminPassword` 返回的 key 决定,它从不抛。
 */
export default function AdminPasswordPanel({ onClose }: { onClose: () => void }) {
  const { tk } = useT();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<AdminPasswordUpdateNotice | null>(null);
  const withMin = (text: string) => text.replace('{n}', String(ADMIN_PASSWORD_MIN_LENGTH));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !password || !confirm) return;
    setPending(true);
    const next = await updateAdminPassword(
      (attributes) => supabaseAuth().auth.updateUser(attributes),
      password,
      confirm,
    );
    setNotice(next);
    // 保存成功之后清掉两个框:密码不该在页面状态里多待
    if (next === 'admin.password.saved') {
      setPassword('');
      setConfirm('');
    }
    setPending(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tk('admin.password.title')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="font-body text-sm opacity-70">{withMin(tk('admin.password.hint'))}</p>
        {notice && (
          <p className="font-body text-sm" role="status">
            {withMin(tk(notice))}
          </p>
        )}
        <form onSubmit={submit} className="max-w-md space-y-4">
          <Input
            type="password"
            label={tk('admin.password.new')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            disabled={pending}
          />
          <Input
            type="password"
            label={tk('admin.password.confirm')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            disabled={pending}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || !password || !confirm}>
              {pending ? tk('common.loading') : tk('admin.password.save')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {tk('common.close')}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
