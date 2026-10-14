import { useEffect, useState } from 'react';
import { Button, Card, CardBody, CardHeader, CardTitle, Input } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { supabaseAuth } from '@/lib/supabase';
import { requestAdminLink, type AdminLoginNotice } from '@/lib/adminAuthMessages';
import { signInAdminWithPassword, type AdminPasswordSignInResult } from '@/lib/adminPasswordAuth';

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
 * 后台登录 —— Supabase Auth。**默认邮箱 + 密码,邮件链接(magic link)是备用入口。**
 *
 * 【为什么不自己发明认证】密码存储、暴力破解防护、会话管理,每一样做错都是安全事故。
 * 密码也交给 Supabase Auth(bcrypt、限流、泄露密码检测都在它那边);这个页面只负责把两个框交给它。
 *
 * 【两种方式,一个入口】(Viho 2026-10-14)平时用密码,不用等邮件;忘了密码或还没设置过,
 * 用邮件链接登录,进后台后在「设置密码」里改 —— 所以没有单独的重置密码页。
 * magic link 建出来的账号一开始没有可用的密码,第一次一定要走邮件链接。
 *
 * 【这里登录成功不等于能进后台】能不能进由 `admin_users` 允许名单决定,
 * 而那个判断在 `assessment-admin` 里做。不在名单的人能登录成功、然后拿到 403 ——
 * 这是刻意的:登录与授权是两件事,合成一件会让「不在名单」表现为登录失败,
 * 那会让人以为是邮箱打错了。两种登录方式在这一点上完全一样。
 *
 * 【页面上没有任何能装下原始报错的 state】显示什么只由 `requestAdminLink` /
 * `signInAdminWithPassword` 返回的文案 key 决定,它们从不抛 —— 这个组件手里根本拿不到错误对象。
 * 为什么不能显示 GoTrue 的原文,见 src/lib/adminAuthMessages.ts 与 adminPasswordAuth.ts。
 *
 * 【密码登录成功之后这里什么都不用做】supabase-js 存下 session 并发出 SIGNED_IN,
 * `AdminLayout` 的 onAuthStateChange 收到之后换成后台 —— 与点开 magic link 回来是同一条路。
 */
export default function AdminLogin({ forbidden }: { forbidden?: boolean }) {
  const { tk } = useT();
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<AdminLoginNotice | Exclude<AdminPasswordSignInResult, 'ok'> | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    if (cooldownLeft === 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownLeft, now]);

  function switchMode(next: 'password' | 'link') {
    setMode(next);
    setNotice(null);
    setPassword('');
  }

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !email.trim() || !password) return;
    setPending(true);
    const result = await signInAdminWithPassword(
      (credentials) => supabaseAuth().auth.signInWithPassword(credentials),
      email,
      password,
    );
    // 失败时清掉密码框,邮箱留着(多半是密码打错);成功时这个组件马上会被换掉
    if (result !== 'ok') {
      setNotice(result);
      setPassword('');
    }
    setPending(false);
  }

  async function submitLink(event: React.FormEvent) {
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
          <p className="font-body text-sm opacity-70">
            {tk(mode === 'password' ? 'admin.login.passwordHint' : 'admin.login.hint')}
          </p>

          {notice && (
            <p className="font-body text-sm" role="status">
              {tk(notice)}
            </p>
          )}

          {mode === 'password' ? (
            <form onSubmit={submitPassword} className="space-y-4">
              <Input
                type="email"
                label={tk('admin.login.email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
                disabled={pending}
              />
              <Input
                type="password"
                label={tk('admin.login.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={pending}
              />
              <Button type="submit" block disabled={pending || !email.trim() || !password}>
                {pending ? tk('common.loading') : tk('admin.login.passwordAction')}
              </Button>
            </form>
          ) : (
            <form onSubmit={submitLink} className="space-y-4">
              <Input
                type="email"
                label={tk('admin.login.email')}
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
          )}

          <button
            type="button"
            onClick={() => switchMode(mode === 'password' ? 'link' : 'password')}
            disabled={pending}
            className="font-body text-sm underline underline-offset-4 disabled:opacity-40"
          >
            {tk(mode === 'password' ? 'admin.login.useLink' : 'admin.login.usePassword')}
          </button>
        </CardBody>
      </Card>
    </main>
  );
}
