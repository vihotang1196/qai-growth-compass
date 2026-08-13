import { Button } from '@/components/brutalist';
import { useT } from '@/lib/i18n';
import type { ReportPayload } from '@/lib/reportApi';

/**
 * 报告页上「每种语言一个动作」的那一块。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 【为什么从 Report.tsx 里抽出来 —— 不只是为了短】
 * 抽出来之后这段 JSX 才能被 `renderToStaticMarkup` 直接渲。`Report.tsx` 自己在 SSR 下
 * 只会渲出 loading 态(数据是 useEffect 拉的),断言落不到真实的按钮上。
 * 与 `RosterRow` / `ShareCardView` / `LiveSlide` 同一个先例。
 *
 * 【两个并列的按钮,不是一个下拉】下拉会把「有两份」这件事藏进一次点击之后;
 * 两个按钮一眼看得出。
 *
 * 【按钮上写语言的名字,不用图标】图标每天都在那里,看一眼得不到可行动的信息,
 * 一周之后没人再看它 —— 而这里要传达的恰恰是「你正在下载的是哪一种语言」。
 * (与名单页显示条数而不是感叹号是同一条:什么东西会被眼睛过滤掉。)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function ReportFileActions({
  files,
  current,
  currentStatus,
  pollDone,
  opening,
  generating,
  onOpen,
  onGenerate,
}: {
  files: ReportPayload['files'];
  /** 这个人当前的语言 —— 当前那份走轮询,另一种不轮询 */
  current: 'zh' | 'en';
  /** 当前语言那份的轮询状态(finalize 触发的那一份可能正在渲) */
  currentStatus: string;
  /** 轮询已放弃 —— 不再显示「正在生成」,回到静态兜底 */
  pollDone: boolean;
  opening: boolean;
  generating: 'zh' | 'en' | null;
  onOpen: (lang: 'zh' | 'en') => void;
  onGenerate: (lang: 'zh' | 'en') => void;
}) {
  const { tk } = useT();

  return (
    <div className="flex flex-wrap items-center gap-3">
      {files.map((f) => {
        const name = tk(`lang.name.${f.lang}` as never);
        const isCurrent = f.lang === current;
        const ready = f.availability === 'ready' || (isCurrent && currentStatus === 'ready');

        if (ready) {
          return (
            <Button
              key={f.lang}
              variant={isCurrent ? 'primary' : 'outline'}
              onClick={() => onOpen(f.lang)}
              disabled={opening}
            >
              {opening ? tk('report.pdf.opening') : tk('report.pdf.downloadIn').replace('{lang}', name)}
            </Button>
          );
        }

        if (f.availability === 'working' || generating === f.lang) {
          return (
            <p key={f.lang} className="font-body text-sm opacity-70">
              {tk('report.pdf.generatingIn').replace('{lang}', name)}
            </p>
          );
        }

        if (f.availability === 'exhausted') {
          // 重试用完了 —— 再点也不会好,所以给的是说明,而不是一个必然失败的按钮
          return (
            <p key={f.lang} className="font-body text-sm">
              {tk('report.pdf.exhaustedIn').replace('{lang}', name)}
            </p>
          );
        }

        /**
         * 当前语言那份还在渲(finalize 刚触发)—— 显示静态文案而**不给按钮**:
         * 给按钮等于邀请他再触发一次,而那是又一次 Lambda。
         */
        if (isCurrent && !pollDone && currentStatus !== 'failed' && currentStatus !== 'failed_permanent') {
          return (
            <p key={f.lang} className="font-body text-sm opacity-70">
              {tk('report.pdf.rendering')}
            </p>
          );
        }

        // absent / failed —— 显式的「生成 X 版」。他知道自己在触发一次生成
        return (
          <Button
            key={f.lang}
            variant="outline"
            onClick={() => onGenerate(f.lang)}
            disabled={generating !== null}
          >
            {tk('report.pdf.generateIn').replace('{lang}', name)}
          </Button>
        );
      })}
    </div>
  );
}
