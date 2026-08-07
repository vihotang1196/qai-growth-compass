import { useT } from '@/lib/i18n';
import { Badge, Button, Td, Tr } from '@/components/brutalist';

export interface RosterRowData {
  id: string;
  name: string | null;
  phone_e164: string | null;
  phone_raw: string | null;
  email_lower: string | null;
  status: string;
  first_login_at: string | null;
  completed_at: string | null;
  access_revoked_at: string | null;
  cohort: { id: string; name: string } | null;
  session: {
    id: string;
    status: string;
    result: {
      total: number;
      tier: string;
      weakest: string[];
      pdf_status: string;
      pdf_last_error: string | null;
    } | null;
  } | null;
}

/**
 * 表头 —— **一份实现,表头和错误详情行的 colSpan 都从这里取**。
 *
 * colSpan 写死成 12 的话,下次加一列时详情行会少跨一格,而那种错位不会有任何东西报错,
 * 只会看起来「有点歪」。列表在这里,长度自己算。
 */
export const ROSTER_COLUMNS = [
  'admin.col.name',
  'admin.col.phone',
  'admin.col.email',
  'admin.col.cohort',
  'admin.col.status',
  'admin.col.firstLogin',
  'admin.col.completed',
  'admin.col.total',
  'admin.col.tier',
  'admin.col.weakest',
  'admin.col.pdf',
  'admin.col.actions',
] as const;

const fmt = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');

export interface RosterRowProps {
  row: RosterRowData;
  /** 这一行正在跑某个操作 */
  busy: boolean;
  /** 错误详情行是否展开 —— 状态放在父层,因为它要多渲一个 <tr>,单元格自己做不到 */
  errorOpen: boolean;
  onToggleError: () => void;
  onResend: () => void;
  onRotate: () => void;
  onRevoke: () => void;
  onRenderPdf: () => void;
}

/**
 * 名单里的一行。**从 Roster 里抽出来,不只是为了短** ——
 * 抽出来之后这段 JSX 才能被 renderToStaticMarkup 直接渲(Roster 自己在 SSR 下
 * 只会渲出 loading 态,数据是 useEffect 拉的)。断言因此落在**真实的行标记**上,
 * 而不是测试里另写一份长得差不多的副本(判断标准 4 与 8)。
 */
export default function RosterRow({
  row: r,
  busy,
  errorOpen,
  onToggleError,
  onResend,
  onRotate,
  onRevoke,
  onRenderPdf,
}: RosterRowProps) {
  const { tk } = useT();
  const result = r.session?.result ?? null;
  const pdfError = result?.pdf_last_error ?? null;
  const pdfReady = result?.pdf_status === 'ready';

  return (
    <>
      {/* 号码解析失败的行标红 —— flagged 用黄底,不引入新色相 */}
      <Tr flagged={r.phone_e164 === null}>
        <Td>{r.name ?? '—'}</Td>
        <Td>
          {r.phone_e164 ?? (
            <span className="font-bold">
              {r.phone_raw ?? '—'} · {tk('admin.phoneBad')}
            </span>
          )}
        </Td>
        <Td>{r.email_lower ?? '—'}</Td>
        <Td>{r.cohort?.name ?? '—'}</Td>
        <Td>
          <Badge tone={r.status === 'completed' ? 'ink' : 'muted'}>{r.status}</Badge>
          {r.access_revoked_at && (
            <Badge tone="accent" className="ml-1">
              {tk('admin.revoked')}
            </Badge>
          )}
        </Td>
        <Td>{fmt(r.first_login_at)}</Td>
        <Td>{fmt(r.completed_at)}</Td>
        <Td>{result?.total ?? '—'}</Td>
        <Td>{result?.tier ?? '—'}</Td>
        <Td>{result?.weakest?.join(' / ') ?? '—'}</Td>

        {/*
          PDF 列:只放徽章和一个定宽的开关,**错误文本一个字都不进这一列**。

          【原来为什么会横穿整个操作区】上一版把 pdf_last_error 直接渲在这个单元格里,
          带着 `max-w-[16rem] break-words` —— 那两个类都是不生效的:
          `Td` 有 `whitespace-nowrap`,而它会继承给里面的文本,于是 break-words 无从换行;
          文本撑成一整条不折行的长句,直接溢出那个 16rem 的盒子。
          `pdf_last_error` 入库时截到 1000 字符,所以最坏情况就是一条 1000 字符的横线,
          把最后那一列(操作区)推到屏幕外。

          【而失败那一行恰恰是最需要立刻操作的一行】它现在反而最难操作 ——
          这不是「有点丑」,是把最紧急的操作变得最难够到。失败是少数,
          不该让少数情况决定常态布局。
        */}
        <Td>
          {result ? (
            <div className="flex items-center gap-2">
              <Badge tone={pdfReady ? 'ink' : 'muted'}>{result.pdf_status}</Badge>
              {pdfError && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onToggleError}
                  aria-expanded={errorOpen}
                  aria-controls={`pdf-error-${r.id}`}
                >
                  {errorOpen ? tk('admin.pdf.hideError') : tk('admin.pdf.showError')}
                </Button>
              )}
            </div>
          ) : (
            '—'
          )}
        </Td>

        <Td>
          <div className="flex gap-1">
            {/* 查看报告要等 Stage 8 —— 现在禁用而不是隐藏,让人知道它会有 */}
            <Button size="sm" variant="ghost" disabled title="Stage 8">
              {tk('admin.action.report')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || r.access_revoked_at !== null}
              onClick={onResend}
            >
              {tk('admin.action.resend')}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={onRotate}>
              {tk('admin.action.rotate')}
            </Button>
            <Button
              size="sm"
              variant="solid"
              disabled={busy || r.access_revoked_at !== null}
              onClick={onRevoke}
            >
              {tk('admin.action.revoke')}
            </Button>

            {/*
              重新生成 PDF:**位置固定,ready 时留空**。

              【为什么不是「非 ready 时才渲」】那样这一格的宽度会随行变化,
              而表格的列宽取所有行里最宽的那个 —— 于是 ready 行右侧多出一块空档,
              整列看起来在抖。留空则每一行的按钮都落在同一个横坐标上。

              【为什么用 visibility 而不是写死宽度】按钮宽度取决于标签文字,
              而中英文两版宽度不同(「重新生成 PDF」vs "Re-generate PDF")。
              写死 rem 要么夹到文字要么留出空隙;渲一个不可见的同款按钮,
              宽度自动就是对的。visibility: hidden 同时会把它移出 tab 序,
              所以键盘不会停在一个看不见的按钮上。

              仍然是【任何非 ready 状态都可用】,不只 failed_permanent ——
              finalize 那次触发可能丢,卡住的 pending 否则没有出路
              (见 assessment-admin 的 render_pdf)。
            */}
            {result && (
              <Button
                size="sm"
                variant="outline"
                className={pdfReady ? 'invisible' : undefined}
                aria-hidden={pdfReady || undefined}
                disabled={busy || pdfReady}
                onClick={onRenderPdf}
              >
                {busy ? tk('admin.pdf.rendering') : tk('admin.action.renderPdf')}
              </Button>
            )}
          </div>
        </Td>
      </Tr>

      {/*
        错误详情:**整行铺开,不占任何一列的宽度**。

        原文照登,不做摘要 —— 「生成失败」那种话没法照着行动,而这段文本里带着
        url / FONTCONFIG_PATH / HOME / dirBefore 和三个常见成因,是要被整段复制走的。
        所以要能选中、要换行(覆盖掉 Td 继承下来的 whitespace-nowrap)。
      */}
      {errorOpen && pdfError && (
        <Tr>
          <Td colSpan={ROSTER_COLUMNS.length} className="whitespace-normal bg-line-soft/20">
            <div
              id={`pdf-error-${r.id}`}
              className="max-w-3xl whitespace-pre-wrap break-words font-mono text-xs"
            >
              <span className="font-head font-bold uppercase tracking-wider">
                {tk('admin.pdf.errorLabel')}
              </span>
              <br />
              {pdfError}
            </div>
          </Td>
        </Tr>
      )}
    </>
  );
}
