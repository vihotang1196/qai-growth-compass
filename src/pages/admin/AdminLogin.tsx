import { useEffect, useState } from 'react';
import { Button, Card, CardBody, CardHeader, CardTitle, Input } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { supabaseAuth } from '@/lib/supabase';
import { requestAdminLink, type AdminLoginNotice } from '@/lib/adminAuthMessages';

/**
 * 发送按钮的冷却时长。
 *
 * ⚠️ **这只是 UX,不是安全边界。** 公开 key 就在 bundle 里,任何人都能绕过这个页面
 * 直接调 `/auth/v1/otp`。真正的限流在 Supabase 侧(每用户发信间隔 + 项目级每小时
 * 发信上限)。这里只是让等信的人别连点 —— 连点在服务端会被节流成 429,
 * 而那在页面上和其他结果显示同一句,人会以为点一次就发了一封。
 */
const COOLDOWN_MS = 60_000;

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
 *
 * 【页面上没有任何能装下原始报错的 state】请求之后显示什么只由 `requestAdminLink`
 * 返回的文案 key 决定,它从不抛 —— 这个组件手里根本拿不到错误对象。
 * 为什么不能显示 GoTrue 的原文,见 src/lib/adminAuthMessages.ts。
 */
export default function AdminLogin({ forbidden }: { forbidden?: boolean }) {
  const { tk } = useT();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<AdminLoginNotice | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    if (cooldownLeft === 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownLeft, now]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || cooldownLeft > 0 || !email.trim()) return;
    setPending(true);
    const next = await requestAdminLink(
      (request) => supabaseAuth().auth.signInWithOtp(request),
      email.trim(),
      `${window.location.origin}/admin`,
    );
    setNotice(next);
    // 只有拿到了 HTTP 响应才冷却:网络失败时请求根本没到,该让人立刻重试
    if (next === 'admin.login.neutral') {
      const startedAt = Date.now();
      setNow(startedAt);
      setCooldownUntil(startedAt + COOLDOWN_MS);
    }
    setPending(false);
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

          {notice && (
            <p className="font-body text-sm" role="status">
              {tk(notice)}
            </p>
          )}

          <form onSubmit={submit} className="space-y-4">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={pending}
            />
            <Button type="submit" block disabled={pending || cooldownLeft > 0 || !email.trim()}>
              {pending
                ? tk('common.loading')
                : cooldownLeft > 0
                  ? tk('admin.login.cooldown').replace('{n}', String(cooldownLeft))
                  : tk('admin.login.action')}
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}
