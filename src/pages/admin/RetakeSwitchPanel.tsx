import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, CardBody, CardHeader, CardTitle } from '@/components/brutalist';
import { useConfirm } from '@/components/ConfirmProvider';
import { adminPost, AdminAuthError } from '@/lib/adminApi';
import { useT } from '@/lib/i18n';
import { formatMalaysiaTime } from '@/lib/retakeView';
import { createSingleFlight } from '@/lib/singleFlight';
import {
  nextSwitchValue,
  parseSwitchState,
  setSwitchFlow,
  switchConfirmKeys,
  switchStatus,
  type RetakeSwitchState,
} from '@/lib/retakeSwitch';

/**
 * 后台「重填开关」面板(重填第 5 步的准备,Viho 2026-10-16)。判定全在 `src/lib/retakeSwitch.ts`,这里只画与接线。
 *
 * 【为什么在顶栏、不在某个标签页里】出问题时要「立刻关掉」:登录后台 → 顶栏「重填开关」→「关闭重填」→ 确认。
 * 不用改代码、不用部署,不用先找到它在哪个标签下。
 *
 * 【打开面板才读】不在每次进后台时多发一个请求;每次打开都重读(两个管理员各开一个页面,看到的都是库里的样子)。
 */
export interface RetakeSwitchViewProps {
  /** null = 还没读到或读失败 */
  state: RetakeSwitchState | null;
  loading: boolean;
  /** 设开关的请求在路上 */
  busy: boolean;
  notice: string | null;
  onSet: () => void;
  onReload: () => void;
  onClose: () => void;
}

export function RetakeSwitchView({ state, loading, busy, notice, onSet, onReload, onClose }: RetakeSwitchViewProps) {
  const { tk, locale } = useT();
  const status = switchStatus(state);
  const next = nextSwitchValue(status);
  const recent = state?.recent ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tk('admin.retakeSwitch.title')}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="font-body text-base font-bold" role="status" data-switch-status={loading ? 'loading' : status}>
          {loading ? tk('common.loading') : tk(`admin.retakeSwitch.status.${status}`)}
        </p>
        <p className="font-body text-sm opacity-70">{tk('admin.retakeSwitch.scope')}</p>
        {notice && (
          <p className="font-body text-sm" role="alert">
            {notice}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {!loading && (
            <Button
              size="sm"
              className="whitespace-nowrap"
              // 「关闭」用实心的那个颜色:出问题时它是要一眼找到的按钮
              variant={next ? 'outline' : 'primary'}
              busy={busy}
              onClick={onSet}
              data-testid="retake-switch-set"
            >
              {tk(next ? 'admin.retakeSwitch.turnOn' : 'admin.retakeSwitch.turnOff')}
            </Button>
          )}
          <Button size="sm" className="whitespace-nowrap" variant="outline" onClick={onReload} disabled={loading || busy}>
            {tk('admin.retakeSwitch.reload')}
          </Button>
          <Button size="sm" className="whitespace-nowrap" variant="outline" onClick={onClose}>
            {tk('common.close')}
          </Button>
        </div>
        <div className="space-y-2">
          <h3 className="font-head text-sm font-bold uppercase tracking-wide">{tk('admin.retakeSwitch.history')}</h3>
          {recent.length > 0 ? (
            <ul className="space-y-1 font-body text-sm">
              {recent.map((c, i) => (
                <li key={`${c.at}-${i}`} className="break-words">
                  {formatMalaysiaTime(c.at, locale)} · {tk(c.open ? 'admin.retakeSwitch.history.on' : 'admin.retakeSwitch.history.off')} · {c.by}
                </li>
              ))}
            </ul>
          ) : (
            // 读不到的时候不说「没切换过」—— 那会是一句没根据的话
            !loading && status !== 'unreadable' && <p className="font-body text-sm opacity-70">{tk('admin.retakeSwitch.history.empty')}</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

export default function RetakeSwitchPanel({ onClose, onAuthLost }: { onClose: () => void; onAuthLost: (forbidden: boolean) => void }) {
  const { tk } = useT();
  const ask = useConfirm();
  const [state, setState] = useState<RetakeSwitchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** 整个「问 → 发」一次只跑一个:确认框开着时再点,不会弹第二个 */
  const guard = useRef(createSingleFlight());

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      setState(parseSwitchState(await adminPost<unknown>('retake_switch')));
    } catch (err) {
      if (err instanceof AdminAuthError) return onAuthLost(err.status === 403);
      setState(null);
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onAuthLost]);

  useEffect(() => {
    void load();
  }, [load]);

  function set() {
    void guard.current.run(async () => {
      const next = nextSwitchValue(switchStatus(state));
      const keys = switchConfirmKeys(next);
      setNotice(null);
      const out = await setSwitchFlow({
        ask,
        confirm: { title: tk(keys.title), description: tk(keys.description), confirmLabel: tk(keys.confirmLabel) },
        next,
        request: async (open) => {
          setBusy(true);
          try {
            return await adminPost<unknown>('retake_switch_set', { open });
          } finally {
            setBusy(false);
          }
        },
      });
      if (out.kind === 'done') return setState(out.state);
      if (out.kind === 'authLost') return onAuthLost(out.forbidden);
      // 失败:不知道写进去没有 —— 重读一次,页面显示库里的样子,再把错误放在上面
      if (out.kind === 'failed') {
        await load();
        setNotice(out.message);
      }
    });
  }

  return (
    <RetakeSwitchView
      state={state}
      loading={loading}
      busy={busy}
      notice={notice}
      onSet={set}
      onReload={() => void load()}
      onClose={onClose}
    />
  );
}
