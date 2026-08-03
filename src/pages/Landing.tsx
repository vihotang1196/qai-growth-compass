import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardBody } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { postJson } from '@/lib/api';

interface AuthResponse {
  /** 已经带上 ?lang= 的完整路径,由后端推导 —— 前端不参与决定去哪 */
  target: string;
  lang: 'zh' | 'en';
}

/**
 * 魔法链接入口。
 *
 * 带 `?t=` → 调 assessment-auth,拿后端推导出的 target 跳过去。
 * 不带 → 目前跳 /expired。**Stage 4 的第二半(备用路径:输手机/邮箱重发链接)
 * 还没做,它卡在 GHL_RESEND_WEBHOOK_URL 上** —— 在那之前这里放一个能提交的表单
 * 是假的,提交了没有任何事发生。所以先跳 /expired,那一半做完再换成表单。
 *
 * 【跳转用 replace】token 不留在浏览器历史里 —— 共用设备时按后退键
 * 不该把别人的登录凭证翻出来。
 */
export default function Landing() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { tk, locale } = useT();
  const [failed, setFailed] = useState(false);
  /** StrictMode 下 effect 会跑两次,token 只该被兑换一次 */
  const started = useRef(false);

  const token = params.get('t');

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token) {
      navigate(`/expired?lang=${locale}`, { replace: true });
      return;
    }

    postJson<AuthResponse>('assessment-auth', { token, lang: locale })
      .then((res) => navigate(res.target, { replace: true }))
      .catch(() => setFailed(true));
  }, [token, locale, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6">
      <Card shadow="lg" className="w-full max-w-md">
        <CardBody className="text-center">
          {failed ? tk('common.retry') : tk('landing.verifying')}
        </CardBody>
      </Card>
    </main>
  );
}
