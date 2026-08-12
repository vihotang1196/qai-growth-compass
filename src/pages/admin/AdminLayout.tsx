import { useEffect, useState } from 'react';
import { Button } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { supabaseAuth } from '@/lib/supabase';
import AdminLogin from './AdminLogin';
import Roster from './Roster';
import CohortDashboard from './CohortDashboard';
import FunnelPanel from './FunnelPanel';

/**
 * 后台外壳 + 路由守卫。
 *
 * ⚠️ **这一层是 UX,不是安全边界。**
 *
 * 它做的全部事情是:没有 Supabase session 就显示登录页,而不是显示一个空表格。
 * 它【不】保护任何数据 —— 数据全在 `assessment-admin` 后面,那个函数每次请求都
 * 重新验 JWT 并查 `admin_users` 允许名单。绕过这一层(改 JS、直接发请求)什么也拿不到。
 *
 * 【为什么刻意写得这么薄】一个看起来很严密的前端守卫会让后来的人以为那一层有保护,
 * 从而在后端放松检查。薄反而更诚实:任何人看这个文件三十秒就知道它不负责安全。
 */
/**
 * 清掉回调 URL 上残留的 fragment。
 *
 * 【走 PKCE 之后这里平时不会触发】token 已经不进 URL 了,回调只带 `?code=`,
 * 而 auth-js 对 code 用的是 replaceState —— 干净。见 lib/supabase.ts。
 *
 * 【那为什么还留着】**换 flow 之前已经发出去的 magic link 还躺在收件箱里**,
 * 那些链接仍然是 hash 形式。auth-js 按 URL 的实际形态决定走哪条路径,
 * 所以点开一条旧链接仍会走 implicit —— 而它清 hash 用的是
 * `window.location.hash = ''`,那是一次 fragment 导航:新增一条历史记录,
 * 带 token 的那条留在后面,地址栏只剩一个裸 `#`。
 *
 * 这四行把当前那条换成干净 URL。它不能删掉更早那条(History API 没有删除条目的
 * 能力)—— 所以它是旧链接的兜底,不是防线;真正的防线是 PKCE。
 * 等收件箱里的旧链接都过期(Supabase 默认 1 小时)之后这段就可以删。
 *
 * 【判断条件不能用 location.hash】auth-js 清完之后它返回 '',而 URL 上那个裸 `#`
 * 还在,用它判断永远为假。要看 href 里有没有 `#`。
 */
function stripUrlFragment(): void {
  const { pathname, search, href } = window.location;
  if (!href.includes('#')) return;
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
}

export default function AdminLayout() {
  const { tk } = useT();
  const [checked, setChecked] = useState(false);
  /** Stage 10 的四个模块会陆续加进这个 tab —— 现在两个 */
  const [tab, setTab] = useState<'roster' | 'dashboard' | 'funnel'>('roster');
  const [signedIn, setSignedIn] = useState(false);
  /** 403:有身份但不在名单。这时【不】该把人弹回登录页 */
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const auth = supabaseAuth().auth;
    void auth.getSession().then(({ data }) => {
      setSignedIn(data.session !== null);
      setChecked(true);
      stripUrlFragment();
    });
    const { data: sub } = auth.onAuthStateChange((_event, session) => {
      setSignedIn(session !== null);
      if (session === null) setForbidden(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!checked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted p-6 font-body">
        {tk('common.loading')}
      </main>
    );
  }

  if (!signedIn || forbidden) return <AdminLogin forbidden={forbidden} />;

  return (
    <main className="min-h-screen bg-muted p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex items-center justify-between gap-4">
          <h1 className="font-head text-2xl font-bold uppercase tracking-tight md:text-3xl">
            {tk('admin.title')}
          </h1>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void supabaseAuth().auth.signOut()}
          >
            {tk('admin.signOut')}
          </Button>
        </header>
        <nav className="flex gap-2">
          {(['roster', 'dashboard', 'funnel'] as const).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tab === t ? 'primary' : 'outline'}
              onClick={() => setTab(t)}
            >
              {tk(`admin.tab.${t}` as Parameters<typeof tk>[0])}
            </Button>
          ))}
        </nav>
        {tab === 'roster' ? (
          <Roster
            onAuthLost={(isForbidden) => {
              if (isForbidden) setForbidden(true);
              else void supabaseAuth().auth.signOut();
            }}
          />
        ) : tab === 'dashboard' ? (
          <CohortDashboard
            onAuthLost={(isForbidden) => {
              if (isForbidden) setForbidden(true);
              else void supabaseAuth().auth.signOut();
            }}
          />
        ) : (
          <FunnelPanel
            onAuthLost={(isForbidden) => {
              if (isForbidden) setForbidden(true);
              else void supabaseAuth().auth.signOut();
            }}
          />
        )}
      </div>
    </main>
  );
}
