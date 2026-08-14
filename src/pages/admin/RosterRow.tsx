import { useT } from '@/lib/i18n';
import { parseWarnings, warningLabelKey } from '../../../api/_lib/entitlementWarnings';
import { langStates } from '../../../api/_lib/reportFiles';
import { Badge, Button, Td, Tr } from '@/components/brutalist';

export interface RosterRowData {
  id: string;
  name: string | null;
  /** 这个人的语言(zh / en)—— 语言跟着人走,见 _shared/lang.ts */
  lang?: string | null;
  /** webhook 最近一次写入时的告警(jsonb 数组)。名单页负责让它可见 */
  warnings?: unknown;
  phone_e164: string | null;
  phone_raw: string | null;
  email_lower: string | null;
  status: string;
  first_login_at: string | null;
  completed_at: string | null;
  access_revoked_at: string | null;
  cohort: { id: string; name: string; is_test: boolean } | null;
  session: {
    id: string;
    status: string;
    /** 每种语言一行报告文件;一行都没有是正常的(还没答完 / 渲染还没落库) */
    files?: {
      lang: string;
      pdf_status: string;
      pdf_path: string | null;
      pdf_attempts: number | null;
      pdf_last_error: string | null;
      share_card_error: string | null;
    }[];
    /**
     * 【只剩三个字段】`pdf_status` / `pdf_last_error` / `share_card_error` 已经搬到
     * `files`(按语言分行),而 roster 的查询**也不再 select 它们** ——
     * 留在类型里的话它们恒为 `undefined`,而读它们的代码不会报错、只会静默拿到空值。
     * 类型里的死字段 `check:legacy-columns` 扫不到(它看的是查询参数),所以只能靠删。
     */
    result: {
      total: number;
      tier: string;
      weakest: string[];
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
  'admin.col.warnings',
  'admin.col.files',
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
  /** 重新生成某一种语言 —— **必须带 lang**,后端没有默认值 */
  onRenderPdf: (lang: 'zh' | 'en') => void;
  onOpenReport: () => void;
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
  onOpenReport,
}: RosterRowProps) {
  const { tk } = useT();
  const result = r.session?.result ?? null;
  /**
   * 每种语言各自的状态。`langStates` **总是返回全部语言** ——
   * 缺的那种是 `absent`,而那正是这一格里的「—」。
   */
  const files = r.session?.files ?? [];
  const states = langStates(files);
  const pdfErrors = files.filter((f) => f.pdf_last_error).map((f) => `${f.lang}: ${f.pdf_last_error}`);
  const cardErrors = files.filter((f) => f.share_card_error).map((f) => `${f.lang}: ${f.share_card_error}`);
  /**
   * 两种错误共用同一个展开行。分开做两个开关会让这一列长出第二个按钮,
   * 而那一列的全部要求就是【定宽】—— 名单页那次的教训。
   */
  const anyError = pdfErrors.length > 0 || cardErrors.length > 0;
  /**
   * 【坏值不该让名单页打不开】`parseWarnings` 把认不出的项丢掉而不抛 ——
   * 这一列是 jsonb、历史行是 null、以后也可能被手工改过,
   * 而名单页是运营每天都要用的东西。
   */
  const warnings = parseWarnings(r.warnings);

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
        <Td>
          {r.cohort?.name ?? '—'}
          {/* 测试批次当场标出来 —— 显示出来了却看不出哪几条是假的,比不显示更糟 */}
          {r.cohort?.is_test && (
            <Badge tone="accent" className="ml-1">
              {tk('admin.testBadge')}
            </Badge>
          )}
        </Td>
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
          告警列 —— **一眼看出「这行有」,点开看「是什么」**。

          【为什么不是一个感叹号图标】图标会变成装饰:它每天都在那里,而看它一眼
          得不到任何可行动的信息,于是一周之后没人再看它。这里放条数 + 可点开 ——
          「2 条」是个会变的数字,而数字变了人会注意到。

          【为什么详情走那个已有的展开行】它要整行铺开(告警文本里带着 GHL 那边填错的值,
          是要被复制走的),而单元格宽度不该被最坏情况决定 —— 与 pdf_last_error
          那次同一个教训:失败是少数,不该让少数情况决定常态布局。
        */}
        <Td>
          {warnings.length === 0 ? (
            tk('admin.warnNone')
          ) : (
            <button
              type="button"
              onClick={onToggleError}
              aria-expanded={errorOpen}
              aria-controls={`row-detail-${r.id}`}
              className="border-brutal border-line px-2 py-0.5 font-head text-xs font-bold underline"
            >
              {tk('admin.warnCount').replace('{n}', String(warnings.length))}
            </button>
          )}
        </Td>

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
        {/*
          ── 报告文件那一格:`zh ✓ / en —` ──

          【没有 result 时给单个「—」,而不是「zh — / en —」】
          这两种情况**不是同一件事**:
            · 没 result = 他还没答完 → **不该有** PDF。写成「zh — / en —」等于说
              「两份都缺」,而运营会去找一个不存在的渲染问题;
            · 有 result 而没有文件行 = **该有但还没有** → 那才是「zh — / en —」。
          空白也不行(你说得对:空白会让人以为这一列坏了),所以三种情况三种写法。

          【每种状态一个短记号,不是图标】名单页是用来扫的,而记号要能一眼分出
          「好了 / 在生成 / 出错 / 没有」。图标做不到这件事 —— 它只说明「有东西」。
        */}
        <Td>
          {result ? (
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap font-mono text-xs">
                {states.map((st) => `${st.lang} ${tk(`admin.file.${st.availability}` as never)}`).join(' / ')}
              </span>
              {anyError && (
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
            {/*
              查看报告。**启用条件是「有 result」,不是 pdf_status** ——
              报告页读的是 assessment_results,与 PDF 渲染没关系:
              PDF 失败的人报告照样能看(那正是异步化的取向)。
              上一版是硬编码 disabled 的 Stage 8 占位,所以点「重新生成 PDF」
              永远不会让它变 —— 它压根没有启用条件。

              点开走的是**一条 180 秒的渲染令牌**,不是学员的 access_token,
              而且服务端会记一行日志(见 assessment-admin 的 report_link)。
            */}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !result}
              title={tk('admin.action.reportHint')}
              onClick={onOpenReport}
            >
              {busy ? tk('admin.report.opening') : tk('admin.action.report')}
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
            {/*
              【每种语言一个按钮,而且必须显式】一个 session 现在有两份报告文件,
              所以「重新生成」必须说清重渲哪一份 —— 后端那个 action 的 `lang` 是必填、
              没有默认值(给了默认值的话,他点下去会重渲中文那份而他看着的是英文那一行,
              一次 Chromium 冷启动之后想修的那份还是坏的)。

              【ready 的那种语言不给按钮,但占位】与上一版同一个理由:
              按钮宽度会随文案变,而 `invisible` 让 x 位置固定 ——
              失败那一行恰恰是最需要立刻操作的一行,不能让它的按钮位置跟别的行不一样。
            */}
            {result &&
              states.map((st) => (
                <Button
                  key={st.lang}
                  size="sm"
                  variant="outline"
                  className={st.availability === 'ready' ? 'invisible' : undefined}
                  aria-hidden={st.availability === 'ready' || undefined}
                  disabled={busy || st.availability === 'ready'}
                  onClick={() => onRenderPdf(st.lang as 'zh' | 'en')}
                >
                  {busy
                    ? tk('admin.pdf.rendering')
                    : tk('admin.file.regen').replace('{lang}', st.lang)}
                </Button>
              ))}
          </div>
        </Td>
      </Tr>

      {/*
        错误详情:**整行铺开,不占任何一列的宽度**。

        原文照登,不做摘要 —— 「生成失败」那种话没法照着行动,而这段文本里带着
        url / FONTCONFIG_PATH / HOME / dirBefore 和三个常见成因,是要被整段复制走的。
        所以要能选中、要换行(覆盖掉 Td 继承下来的 whitespace-nowrap)。
      */}
      {errorOpen && (anyError || warnings.length > 0) && (
        <Tr>
          <Td colSpan={ROSTER_COLUMNS.length} className="whitespace-normal bg-line-soft/20">
            {warnings.length > 0 && (
              <div id={`row-detail-${r.id}`} className="mb-2 max-w-3xl">
                <div className="font-head text-xs font-bold uppercase tracking-wider">
                  {tk('admin.col.warnings')}
                </div>
                <ul className="list-disc pl-5 font-body text-xs">
                  {warnings.map((w, i) => (
                    <li key={`${w.code}-${i}`} className="whitespace-normal break-words">
                      {tk(warningLabelKey(w.code) as never)}
                      {/* context 是「去哪改」的那一格:GHL 那边到底填了什么 */}
                      {w.context && <span className="font-mono"> — {w.context}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div
              id={`pdf-error-${r.id}`}
              className="max-w-3xl whitespace-pre-wrap break-words font-mono text-xs"
            >
              {pdfErrors.length > 0 && (
                <>
                  <span className="font-head font-bold uppercase tracking-wider">
                    {tk('admin.pdf.errorLabel')}
                  </span>
                  <br />
                  {/* 按语言逐条列 —— 「哪一份坏了」是排查的第一个问题 */}
                  {pdfErrors.join('\n')}
                </>
              )}
              {pdfErrors.length > 0 && cardErrors.length > 0 && <br />}
              {cardErrors.length > 0 && (
                <>
                  <span className="font-head font-bold uppercase tracking-wider">
                    {tk('admin.card.errorLabel')}
                  </span>
                  <br />
                  {cardErrors.join('\n')}
                </>
              )}
            </div>
          </Td>
        </Tr>
      )}
    </>
  );
}
