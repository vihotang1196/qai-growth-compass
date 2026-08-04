import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, CardBody, CardHeader, CardTitle, Input } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { postJson } from '@/lib/api';

interface AuthResponse {
  /** 已经带上 ?lang= 的完整路径,由后端推导 —— 前端不参与决定去哪 */
  target: string;
  lang: 'zh' | 'en';
}

interface ResendResponse {
  /** 'sent' 涵盖命中、命中但被节流、未命中三种情况 —— 后端刻意不区分 */
  status: 'sent' | 'locked';
}

/** 与后端的 RESEND_COOLDOWN_MS 对应。纯 UX,不是安全边界 */
const COOLDOWN_SECONDS = 60;

/**
 * 带 `?t=` → 兑换 token 并跳转。
 *
 * 【跳转用 replace】token 不留在浏览器历史里 —— 共用设备时按后退键
 * 不该把别人的登录凭证翻出来。
 */
function TokenExchange({ token }: { token: string }) {
  const navigate = useNavigate();
  const { tk, locale } = useT();
  const [failed, setFailed] = useState(false);
  /** StrictMode 下 effect 会跑两次,token 只该被兑换一次 */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    postJson<AuthResponse>('assessment-auth', { token, lang: locale })
      .then((res) => navigate(res.target, { replace: true }))
      .catch(() => setFailed(true));
  }, [token, locale, navigate]);

  return (
    <Card shadow="lg" className="w-full max-w-md">
      <CardBody className="text-center">
        {failed ? tk('login.expired') : tk('landing.verifying')}
      </CardBody>
    </Card>
  );
}

/**
 * 无 token → 备用路径:输入手机或邮箱,重发链接。
 *
 * 【三件事刻意做成看不出区别】
 *   1. 文案 —— 命中、未命中、命中但被 60 秒节流,前端显示的都是同一句
 *   2. 耗时 —— 后端补齐到固定下限,不能靠响应快慢反推名单
 *   3. 不做 OTP —— 能收到链接本身就是身份验证,猜中号码的人拿不到任何内容
 *
 * 'locked' 是唯一可区分的状态,它按 IP 判定,与「这个标识是否存在」无关。
 */
function ResendForm() {
  const { tk, locale } = useT();
  const [identifier, setIdentifier] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<'sent' | 'locked' | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || cooldown > 0 || !identifier.trim()) return;
    setPending(true);
    try {
      const res = await postJson<ResendResponse>('assessment-login-request', {
        identifier: identifier.trim(),
        lang: locale,
      });
      setResult(res.status);
      if (res.status === 'sent') setCooldown(COOLDOWN_SECONDS);
    } catch {
      // 网络失败也显示同一句 —— 任何可区分的错误状态都是一条旁路
      setResult('sent');
      setCooldown(COOLDOWN_SECONDS);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card shadow="lg" className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{tk('login.title')}</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <Input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={tk('login.placeholder')}
            autoComplete="username"
            disabled={pending}
          />
          <Button type="submit" block disabled={pending || cooldown > 0 || !identifier.trim()}>
            {pending ? tk('common.loading') : tk('login.action')}
          </Button>
        </form>

        {result === 'locked' && <p className="mt-4 font-body text-sm">{tk('login.locked')}</p>}
        {result === 'sent' && (
          <div className="mt-4 space-y-2 font-body text-sm">
            <p>{tk('login.sent')}</p>
            {cooldown > 0 && <p className="opacity-60">{tk('login.throttled')}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function Landing() {
  const [params] = useSearchParams();
  const token = params.get('t');

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6">
      {token ? <TokenExchange token={token} /> : <ResendForm />}
    </main>
  );
}
