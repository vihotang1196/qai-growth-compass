import { useState } from 'react';
import { Button, Card, CardBody, CardHeader, CardTitle, Input } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { supabaseAuth } from '@/lib/supabase';

/**
 * 后台登录 —— Supabase Auth 的 email magic link。
 *
 * 【为什么不自己发明认证】密码存储、重置流程、暴力破解防护、会话管理,每一样做错
 * 都是安全事故。Supabase Auth 已经有了,而后台只有个位数用户,magic link 足够。
 *
 * 【这里发出链接不等于能进后台】能不能进由 `admin_users` 允许名单决定,
 * 而那个判断在 `assessment-admin` 里做。不在名单的人能登录成功、然后拿到 403 ——
 * 这是刻意的:登录与授权是两件事,合成一件会让「不在名单」表现为登录失败,
 * 那会让人以为是邮箱打错了。
 */
export default function AdminLogin({ forbidden }: { forbidden?: boolean }) {
  const { tk } = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !email.trim()) return;
    setPending(true);
    setError(null);
    try {
      const { error: authError } = await supabaseAuth().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/admin` },
      });
      if (authError) throw authError;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6">
      <Card shadow="lg" className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{tk('admin.login.title')}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {/* 403 与 401 分开展示:不在名单的人不该被反复引导去登录 */}
          {forbidden && (
            <p className="border-brutal border-line bg-accent p-3 font-body text-sm">
              {tk('admin.forbidden')}
            </p>
          )}
          <p className="font-body text-sm opacity-70">{tk('admin.login.hint')}</p>

          {sent ? (
            <p className="font-body text-sm">{tk('admin.login.sent')}</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={pending}
                error={error ?? undefined}
              />
              <Button type="submit" block disabled={pending || !email.trim()}>
                {pending ? tk('common.loading') : tk('admin.login.action')}
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
