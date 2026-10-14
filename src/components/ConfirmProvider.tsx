import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import { createConfirmQueue, dialogKeyIntent, type ConfirmQueue } from '@/lib/confirmQueue';

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** 不给就是「确认」。最好写成动作本身(「停用」「换新链接」)—— 人看按钮就知道按下去会发生什么 */
  confirmLabel?: string;
  /** 不给就是「取消」 */
  cancelLabel?: string;
}

const ConfirmContext = createContext<ConfirmQueue<ConfirmOptions> | null>(null);

/**
 * 网站自己的确认框 —— 替代 `window.confirm`(`scripts/check-native-dialogs.mjs` 不让它再出现)。
 *
 *     const ask = useConfirm();
 *     if (!(await ask({ title, description, confirmLabel }))) return;
 *
 * 【为什么不用浏览器自带的】样子由浏览器决定、不跟网站走;而且一些内嵌浏览器(GHL / WhatsApp 里点开的链接)
 * 直接吞掉它 —— `confirm` 静默返回 false,按钮看起来像坏了。
 *
 * 【键盘】Esc = 取消(对话框库自带);回车 = 确认(打开时焦点就在「确认」上;规矩见 `dialogKeyIntent`)。
 * 点遮罩、点右上角 X 也是取消 —— 关掉的方式只有「确认」一种会做事。
 * 【手机】按钮整行宽、48px 高,「确认」在上、「取消」在下;桌面上并排,「确认」在右。
 *
 * 挂在 `main.tsx` 的根上(学员页面与后台共用一个);没有请求时什么都不渲染 —— /share-card 上因此不会多出任何东西。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue] = useState(() => createConfirmQueue<ConfirmOptions>());
  // 提供者没了,还在等的那些一律回答「不」—— 取消是安全的那一边
  useEffect(() => () => queue.cancelAll(), [queue]);
  return (
    <ConfirmContext.Provider value={queue}>
      {children}
      <ConfirmHost queue={queue} />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const queue = useContext(ConfirmContext);
  if (!queue) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return queue.ask;
}

function ConfirmHost({ queue }: { queue: ConfirmQueue<ConfirmOptions> }) {
  const { tk } = useT();
  const req = useSyncExternalStore(queue.subscribe, queue.current, queue.current);
  const confirmRef = useRef<HTMLButtonElement>(null);
  /** 打开前焦点在哪(通常是按下去的那个按钮)—— 关掉之后还给它,键盘用户不会被扔回页面顶上 */
  const returnFocusRef = useRef<Element | null>(null);

  return (
    <Dialog
      open={req !== null}
      onOpenChange={(open) => {
        if (!open && req) queue.settle(req.id, false);
      }}
    >
      {req && (
        <DialogContent
          // 每个请求一次全新的挂载:连着两个请求时,第二个也会把焦点放到它自己的「确认」上
          key={req.id}
          role="alertdialog"
          closeLabel={tk('common.close')}
          className="max-w-md"
          data-testid="confirm-dialog"
          // 没有正文时明说「没有描述」—— 否则 Radix 会在控制台警告缺 Description
          {...(req.opts.description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            returnFocusRef.current = document.activeElement;
            confirmRef.current?.focus();
          }}
          /**
           * 【焦点自己还】Radix 的 Dialog 关掉时把焦点还给它的 `DialogTrigger` —— 而这个对话框是代码里 `ask()` 打开的,
           * 没有 Trigger,焦点于是掉到 <body>(2026-10-14 本地按 Esc 时实测)。这里拦下来,还给打开前的那个元素;
           * 那个元素已经不在页面上了就不还。
           */
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const el = returnFocusRef.current;
            returnFocusRef.current = null;
            if (el instanceof HTMLElement && el.isConnected) el.focus();
          }}
          onKeyDown={(e) => {
            const intent = dialogKeyIntent({
              key: e.key,
              repeat: e.repeat,
              isComposing: e.nativeEvent.isComposing,
              onControl: e.target instanceof Element && e.target.closest('button, a, input, textarea, select') !== null,
            });
            if (intent === 'native') return;
            e.preventDefault();
            if (intent === 'confirm') queue.settle(req.id, true);
          }}
        >
          {/* 不转大写:标题里常带着人名 / 邮箱,转成大写就不是他本人的写法了 */}
          <DialogTitle className="normal-case">{req.opts.title}</DialogTitle>
          {req.opts.description && <DialogDescription>{req.opts.description}</DialogDescription>}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => queue.settle(req.id, false)}>
              {req.opts.cancelLabel ?? tk('common.cancel')}
            </Button>
            <Button
              ref={confirmRef}
              variant="primary"
              className="w-full sm:w-auto"
              data-testid="confirm-dialog-confirm"
              onClick={() => queue.settle(req.id, true)}
            >
              {req.opts.confirmLabel ?? tk('common.confirm')}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
