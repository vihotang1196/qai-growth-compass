import { useEffect, useState } from 'react';
import { Button } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { supabaseAuth } from '@/lib/supabase';
import AdminLogin from './AdminLogin';
import Roster from './Roster';

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
export default function AdminLayout() {
  const { tk } = useT();
  const [checked, setChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  /** 403:有身份但不在名单。这时【不】该把人弹回登录页 */
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const auth = supabaseAuth().auth;
    void auth.getSession().then(({ data }) => {
      setSignedIn(data.session !== null);
      setChecked(true);
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
        <Roster
          onAuthLost={(isForbidden) => {
            if (isForbidden) setForbidden(true);
            else void supabaseAuth().auth.signOut();
          }}
        />
      </div>
    </main>
  );
}
